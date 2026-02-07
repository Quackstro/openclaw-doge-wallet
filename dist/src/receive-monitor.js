/**
 * DOGE Wallet — Incoming Transaction Monitor
 *
 * Polls for new incoming transactions to the wallet address.
 * Detects receives (wallet address in outputs but not inputs),
 * tracks last-seen txid to avoid duplicate notifications.
 * Persists state to disk for restart resilience.
 *
 * Much receive. Very income. Wow. 🐕
 */
import { readFile } from "node:fs/promises";
import { secureWriteFile } from "./secure-fs.js";
import { join } from "node:path";
import { koinuToDoge } from "./types.js";
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_POLL_INTERVAL_MS = 60_000; // 60 seconds — balanced for free-tier API quotas
const MAX_SEEN_TXIDS = 500; // Prevent unbounded growth
// ============================================================================
// ReceiveMonitor
// ============================================================================
export class ReceiveMonitor {
    statePath;
    provider;
    log;
    callbacks;
    pollIntervalMs;
    seenTxids = new Set();
    lastPollAt = null;
    pollTimer = null;
    address = null;
    constructor(dataDir, provider, callbacks, log, pollIntervalMs) {
        this.statePath = join(dataDir, "receive-state.json");
        this.provider = provider;
        this.callbacks = callbacks ?? {};
        this.log = log ?? (() => { });
        this.pollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    }
    // --------------------------------------------------------------------------
    // Public API
    // --------------------------------------------------------------------------
    /**
     * Set the wallet address to monitor.
     */
    setAddress(address) {
        this.address = address;
    }
    /**
     * Start monitoring for incoming transactions.
     */
    start() {
        if (!this.address) {
            this.log("warn", "doge-wallet: receive monitor: no address set, not starting");
            return;
        }
        if (this.pollTimer)
            return; // already running
        // Do an immediate poll
        this.poll().catch((err) => {
            this.log("warn", `doge-wallet: receive monitor initial poll failed: ${err.message ?? err}`);
        });
        this.pollTimer = setInterval(() => {
            this.poll().catch((err) => {
                this.log("warn", `doge-wallet: receive monitor poll failed: ${err.message ?? err}`);
            });
        }, this.pollIntervalMs);
        if (this.pollTimer && typeof this.pollTimer.unref === "function") {
            this.pollTimer.unref();
        }
        this.log("info", `doge-wallet: receive monitor started for ${this.address} (every ${this.pollIntervalMs / 1000}s)`);
    }
    /**
     * Stop monitoring.
     */
    stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            this.log("info", "doge-wallet: receive monitor stopped");
        }
    }
    /**
     * Poll for new incoming transactions.
     */
    async poll() {
        if (!this.address)
            return;
        try {
            const transactions = await this.provider.getTransactions(this.address, 20);
            const incoming = this.detectIncoming(transactions, this.address);
            for (const tx of incoming) {
                if (!this.seenTxids.has(tx.txid)) {
                    this.seenTxids.add(tx.txid);
                    this.log("info", `doge-wallet: new incoming tx detected: ${tx.txid} — ${koinuToDoge(tx.amountKoinu)} DOGE`);
                    try {
                        this.callbacks.onReceive?.(tx);
                    }
                    catch (callbackErr) {
                        this.log("warn", `doge-wallet: receive callback error: ${callbackErr.message ?? callbackErr}`);
                    }
                }
            }
            // Trim seen txids to prevent unbounded growth
            if (this.seenTxids.size > MAX_SEEN_TXIDS) {
                const arr = Array.from(this.seenTxids);
                this.seenTxids = new Set(arr.slice(arr.length - MAX_SEEN_TXIDS));
            }
            this.lastPollAt = new Date().toISOString();
            await this.save();
        }
        catch (err) {
            // Graceful failure — skip this cycle, try again next time
            this.log("warn", `doge-wallet: receive monitor poll error: ${err.message ?? err}`);
        }
    }
    // --------------------------------------------------------------------------
    // Detection logic
    // --------------------------------------------------------------------------
    /**
     * From a list of transactions, find incoming ones:
     * wallet address is in outputs but NOT in inputs.
     */
    detectIncoming(transactions, walletAddress) {
        const result = [];
        for (const tx of transactions) {
            // Skip if wallet address is in inputs (this is a send, not a receive)
            const isSender = tx.inputs.some((inp) => inp.address === walletAddress);
            if (isSender)
                continue;
            // Sum outputs to our address
            let receivedAmount = 0;
            for (const out of tx.outputs) {
                if (out.address === walletAddress) {
                    receivedAmount += out.amount;
                }
            }
            if (receivedAmount > 0) {
                // Best effort: pick the first non-wallet input address as "from"
                const fromAddress = tx.inputs.length > 0 ? tx.inputs[0].address : "unknown";
                result.push({
                    txid: tx.txid,
                    fromAddress,
                    amountKoinu: receivedAmount,
                    confirmations: tx.confirmations,
                    timestamp: tx.timestamp,
                });
            }
        }
        return result;
    }
    // --------------------------------------------------------------------------
    // Persistence
    // --------------------------------------------------------------------------
    async load() {
        try {
            const raw = await readFile(this.statePath, "utf-8");
            const state = JSON.parse(raw);
            if (state.version !== 1) {
                this.log("warn", "doge-wallet: receive state version mismatch, starting fresh");
                return;
            }
            this.seenTxids = new Set(state.seenTxids ?? []);
            this.lastPollAt = state.lastPollAt ?? null;
            this.log("info", `doge-wallet: receive monitor state loaded — ${this.seenTxids.size} seen txids`);
        }
        catch (err) {
            const e = err;
            if (e.code !== "ENOENT") {
                this.log("warn", `doge-wallet: receive state read failed: ${e.message}`);
            }
        }
    }
    async save() {
        const state = {
            version: 1,
            seenTxids: Array.from(this.seenTxids),
            lastPollAt: this.lastPollAt,
        };
        try {
            await secureWriteFile(this.statePath, JSON.stringify(state, null, 2));
        }
        catch (err) {
            this.log("error", `doge-wallet: receive state write failed: ${err.message}`);
        }
    }
}
//# sourceMappingURL=receive-monitor.js.map