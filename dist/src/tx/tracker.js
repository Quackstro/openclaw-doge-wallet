/**
 * DOGE Wallet — Transaction Confirmation Tracker
 *
 * Polls the network for transaction confirmations.
 * Status: pending → confirming (1-5) → confirmed (6+) → failed | unverified
 * Persists active tracking to disk for restart resilience.
 *
 * Rate-limit errors are classified separately from real "not found" errors
 * to avoid false failure alerts when APIs are degraded. Much smart. Very resilient.
 *
 * Much track. Very confirm. Wow. 🐕
 */
import { readFile } from "node:fs/promises";
import { secureWriteFile } from "../secure-fs.js";
import { join } from "node:path";
import { RateLimitError, ProviderError } from "../errors.js";
// ============================================================================
// Constants
// ============================================================================
/** Confirmations required for "confirmed" status */
const CONFIRMED_THRESHOLD = 6;
/** Maximum consecutive real poll failures before marking as failed */
const MAX_POLL_FAILURES = 30;
/** Default poll interval (ms) — 2 minutes baseline to be gentle on APIs */
const DEFAULT_POLL_INTERVAL_MS = 120_000;
/** Maximum backoff interval when APIs are degraded (10 minutes) */
const MAX_BACKOFF_MS = 600_000;
/** Maximum age of a pending tx before considering it failed/unverified (ms) — 24 hours */
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;
// ============================================================================
// Blockchair Fallback Verification
// ============================================================================
/**
 * Try to verify a transaction directly via Blockchair as a fallback
 * when the primary provider is unavailable. Much backup. Very redundant. 🐕
 */
async function verifyViaBlockchair(txid) {
    try {
        const res = await fetch(`https://api.blockchair.com/dogecoin/dashboards/transaction/${txid}`, {
            signal: AbortSignal.timeout(15_000), // 15s timeout for fallback verification
        });
        if (!res.ok)
            return null;
        const data = (await res.json());
        const tx = data?.data?.[txid]?.transaction;
        if (!tx)
            return null;
        return { confirmations: tx.block_id > 0 ? Math.max(1, tx.confirmations ?? 1) : 0 };
    }
    catch {
        return null;
    }
}
// ============================================================================
// Error Classification Helpers
// ============================================================================
/**
 * Check if an error is a rate-limit or transient API error (not a real tx failure).
 * These should NOT count toward pollFailures. Much classify. Very distinguish. 🐕
 */
function isApiDegradedError(err) {
    // Direct type checks
    if (err instanceof RateLimitError)
        return true;
    if (err instanceof ProviderError) {
        // 429 = rate limit, 5xx = server errors — all transient
        if (err.statusCode && (err.statusCode === 429 || err.statusCode >= 500))
            return true;
    }
    // Message-based heuristics for wrapped errors
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    const degradedPatterns = [
        "rate limit",
        "429",
        "throttle",
        "limits reached",
        "blacklist",
        "too many requests",
        "econnrefused",
        "econnreset",
        "etimedout",
        "enotfound",
        "fetch failed",
        "network error",
        "socket hang up",
        "service unavailable",
        "503",
        "502",
        "gateway timeout",
        "504",
    ];
    return degradedPatterns.some((pattern) => msg.includes(pattern));
}
// ============================================================================
// TransactionTracker
// ============================================================================
export class TransactionTracker {
    filePath;
    provider;
    log;
    callbacks;
    basePollIntervalMs;
    tracked = new Map();
    pollTimer = null;
    loaded = false;
    /** Current effective poll interval — increases on API degradation, resets on success */
    currentPollIntervalMs;
    constructor(dataDir, provider, callbacks, log, pollIntervalMs) {
        this.filePath = join(dataDir, "tracking.json");
        this.provider = provider;
        this.callbacks = callbacks ?? {};
        this.log = log ?? (() => { });
        this.basePollIntervalMs = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        this.currentPollIntervalMs = this.basePollIntervalMs;
    }
    // --------------------------------------------------------------------------
    // Public API
    // --------------------------------------------------------------------------
    /**
     * Start tracking a transaction.
     */
    track(txid, metadata) {
        const existing = this.tracked.get(txid);
        if (existing)
            return existing;
        const entry = {
            txid,
            status: "pending",
            confirmations: 0,
            startedAt: new Date().toISOString(),
            lastCheckedAt: new Date().toISOString(),
            pollFailures: 0,
            apiErrors: 0,
            ...metadata,
        };
        this.tracked.set(txid, entry);
        this.save().catch(() => { });
        this.log("info", `doge-wallet: tracking tx ${txid}`);
        // Start polling if not already running
        this.startPolling();
        return entry;
    }
    /**
     * Get the status of a tracked transaction.
     */
    getStatus(txid) {
        return this.tracked.get(txid);
    }
    /**
     * Get all actively tracked transactions.
     */
    getActive() {
        return Array.from(this.tracked.values()).filter((t) => t.status === "pending" || t.status === "confirming");
    }
    /**
     * Get all tracked transactions (including completed).
     */
    getAll() {
        return Array.from(this.tracked.values());
    }
    /**
     * Remove a transaction from tracking.
     */
    remove(txid) {
        const removed = this.tracked.delete(txid);
        if (removed) {
            this.save().catch(() => { });
        }
        return removed;
    }
    /**
     * Poll all active transactions for confirmation updates.
     */
    async pollAll() {
        const active = this.getActive();
        if (active.length === 0) {
            this.stopPolling();
            return;
        }
        for (const entry of active) {
            await this.pollOne(entry);
        }
        await this.save().catch(() => { });
    }
    // --------------------------------------------------------------------------
    // Polling
    // --------------------------------------------------------------------------
    /**
     * Poll a single transaction for confirmation status.
     * Classifies errors as API-degraded vs real tx failures. Much smart. 🐕
     */
    async pollOne(entry) {
        try {
            const tx = await this.provider.getTransaction(entry.txid);
            entry.lastCheckedAt = new Date().toISOString();
            // Successful poll — reset both failure counters and backoff
            entry.pollFailures = 0;
            entry.apiErrors = 0;
            this.resetPollInterval();
            const prevConfirmations = entry.confirmations;
            entry.confirmations = tx.confirmations;
            // Update status
            if (tx.confirmations >= CONFIRMED_THRESHOLD) {
                if (entry.status !== "confirmed") {
                    entry.status = "confirmed";
                    entry.confirmedAt = new Date().toISOString();
                    this.log("info", `doge-wallet: tx ${entry.txid} confirmed (${tx.confirmations} confirmations)`);
                    this.callbacks.onConfirmed?.(entry.txid);
                }
            }
            else if (tx.confirmations >= 1) {
                entry.status = "confirming";
                if (tx.confirmations !== prevConfirmations) {
                    this.log("info", `doge-wallet: tx ${entry.txid} confirming (${tx.confirmations}/${CONFIRMED_THRESHOLD})`);
                    this.callbacks.onConfirmation?.(entry.txid, tx.confirmations);
                }
            }
            // else: still pending, no change
        }
        catch (primaryErr) {
            entry.lastCheckedAt = new Date().toISOString();
            // Classify the error: API degradation vs real tx failure
            if (isApiDegradedError(primaryErr)) {
                // API is degraded — try Blockchair fallback before giving up
                const fallback = await verifyViaBlockchair(entry.txid);
                if (fallback) {
                    // Blockchair found the tx — update status from fallback
                    entry.apiErrors = 0;
                    const prevConfirmations = entry.confirmations;
                    entry.confirmations = fallback.confirmations;
                    if (fallback.confirmations >= CONFIRMED_THRESHOLD) {
                        if (entry.status !== "confirmed") {
                            entry.status = "confirmed";
                            entry.confirmedAt = new Date().toISOString();
                            this.log("info", `doge-wallet: tx ${entry.txid} confirmed via Blockchair fallback (${fallback.confirmations} confirmations)`);
                            this.callbacks.onConfirmed?.(entry.txid);
                        }
                    }
                    else if (fallback.confirmations >= 1) {
                        entry.status = "confirming";
                        if (fallback.confirmations !== prevConfirmations) {
                            this.log("info", `doge-wallet: tx ${entry.txid} confirming via Blockchair fallback (${fallback.confirmations}/${CONFIRMED_THRESHOLD})`);
                            this.callbacks.onConfirmation?.(entry.txid, fallback.confirmations);
                        }
                    }
                    // Reset interval since we got a successful fallback
                    this.resetPollInterval();
                    return;
                }
                // Both primary and fallback failed — count as API error, NOT tx failure
                entry.apiErrors++;
                this.log("warn", `doge-wallet: API degraded for tx ${entry.txid} — ` +
                    `${entry.apiErrors} consecutive API errors (not counted as tx failure). ` +
                    `Primary: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`);
                // Back off polling when APIs are struggling
                this.increasePollInterval();
            }
            else {
                // Real failure (e.g., tx genuinely not found) — try Blockchair before counting
                const fallback = await verifyViaBlockchair(entry.txid);
                if (fallback) {
                    // Blockchair found it even though primary said "not found" — trust Blockchair
                    entry.pollFailures = 0;
                    const prevConfirmations = entry.confirmations;
                    entry.confirmations = fallback.confirmations;
                    if (fallback.confirmations >= CONFIRMED_THRESHOLD) {
                        if (entry.status !== "confirmed") {
                            entry.status = "confirmed";
                            entry.confirmedAt = new Date().toISOString();
                            this.log("info", `doge-wallet: tx ${entry.txid} confirmed via Blockchair fallback (${fallback.confirmations} confirmations)`);
                            this.callbacks.onConfirmed?.(entry.txid);
                        }
                    }
                    else if (fallback.confirmations >= 1) {
                        entry.status = "confirming";
                        if (fallback.confirmations !== prevConfirmations) {
                            this.log("info", `doge-wallet: tx ${entry.txid} confirming via Blockchair fallback (${fallback.confirmations}/${CONFIRMED_THRESHOLD})`);
                            this.callbacks.onConfirmation?.(entry.txid, fallback.confirmations);
                        }
                    }
                    return;
                }
                // Both primary and fallback agree: tx not found — real failure
                entry.pollFailures++;
            }
            // Check if we should give up
            const age = Date.now() - new Date(entry.startedAt).getTime();
            if (entry.pollFailures >= MAX_POLL_FAILURES) {
                // Enough real "not found" responses — mark as failed
                entry.status = "failed";
                entry.failedAt = new Date().toISOString();
                entry.failReason = `Transaction not found after ${entry.pollFailures} polls`;
                this.log("warn", `doge-wallet: tx ${entry.txid} marked failed: ${entry.failReason}`);
                this.callbacks.onFailed?.(entry.txid, entry.failReason);
            }
            else if (age > MAX_PENDING_AGE_MS) {
                // Max age exceeded — check if it's mostly API errors or real failures
                if (entry.pollFailures < MAX_POLL_FAILURES / 2) {
                    // Mostly API errors, few real "not found" — mark as unverified, not failed
                    entry.status = "unverified";
                    entry.unverifiedAt = new Date().toISOString();
                    entry.failReason =
                        `Unable to verify after ${Math.round(age / 60000)} minutes — ` +
                            `${entry.apiErrors} API errors, ${entry.pollFailures} not-found responses`;
                    this.log("warn", `doge-wallet: tx ${entry.txid} marked unverified: ${entry.failReason}`);
                    this.callbacks.onUnverified?.(entry.txid, entry.failReason);
                }
                else {
                    // Significant real "not found" responses — mark as failed
                    entry.status = "failed";
                    entry.failedAt = new Date().toISOString();
                    entry.failReason = `Transaction not confirmed after ${Math.round(age / 60000)} minutes (${entry.pollFailures} not-found responses)`;
                    this.log("warn", `doge-wallet: tx ${entry.txid} marked failed: ${entry.failReason}`);
                    this.callbacks.onFailed?.(entry.txid, entry.failReason);
                }
            }
        }
    }
    // --------------------------------------------------------------------------
    // Adaptive Backoff
    // --------------------------------------------------------------------------
    /**
     * Double the poll interval (up to MAX_BACKOFF_MS) when APIs are degraded.
     * Restarts the polling timer with the new interval. Much patience. 🐕
     */
    increasePollInterval() {
        const newInterval = Math.min(this.currentPollIntervalMs * 2, MAX_BACKOFF_MS);
        if (newInterval !== this.currentPollIntervalMs) {
            this.currentPollIntervalMs = newInterval;
            this.log("warn", `doge-wallet: backing off poll interval to ${this.currentPollIntervalMs / 1000}s due to API degradation`);
            this.restartPolling();
        }
    }
    /**
     * Reset the poll interval back to baseline after a successful poll.
     */
    resetPollInterval() {
        if (this.currentPollIntervalMs !== this.basePollIntervalMs) {
            this.currentPollIntervalMs = this.basePollIntervalMs;
            this.log("info", `doge-wallet: poll interval reset to ${this.basePollIntervalMs / 1000}s after successful poll`);
            this.restartPolling();
        }
    }
    /**
     * Restart the poll timer with the current interval.
     */
    restartPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            this.startPolling();
        }
    }
    startPolling() {
        if (this.pollTimer)
            return;
        if (this.getActive().length === 0)
            return;
        this.pollTimer = setInterval(() => {
            this.pollAll().catch((err) => {
                this.log("warn", `doge-wallet: tracker poll error: ${err}`);
            });
        }, this.currentPollIntervalMs);
        // Don't keep process alive just for tracking
        if (this.pollTimer && typeof this.pollTimer.unref === "function") {
            this.pollTimer.unref();
        }
        this.log("info", `doge-wallet: tracker polling started (every ${this.currentPollIntervalMs / 1000}s)`);
    }
    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            this.log("info", "doge-wallet: tracker polling stopped");
        }
    }
    // --------------------------------------------------------------------------
    // Persistence
    // --------------------------------------------------------------------------
    async load() {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const state = JSON.parse(raw);
            if (state.version !== 1 || !Array.isArray(state.transactions)) {
                this.log("warn", "doge-wallet: invalid tracking state, starting fresh");
                this.loaded = true;
                return;
            }
            this.tracked.clear();
            for (const tx of state.transactions) {
                // Ensure apiErrors field exists for entries persisted before this update
                if (typeof tx.apiErrors !== "number") {
                    tx.apiErrors = 0;
                }
                this.tracked.set(tx.txid, tx);
            }
            this.loaded = true;
            // Resume polling if there are active transactions
            if (this.getActive().length > 0) {
                this.log("info", `doge-wallet: resuming tracking for ${this.getActive().length} active transactions`);
                this.startPolling();
            }
        }
        catch (err) {
            const e = err;
            if (e.code === "ENOENT") {
                this.loaded = true;
                return;
            }
            this.log("warn", `doge-wallet: tracking state read failed: ${e.message}`);
            this.loaded = true;
        }
    }
    async save() {
        const state = {
            version: 1,
            transactions: Array.from(this.tracked.values()),
        };
        try {
            await secureWriteFile(this.filePath, JSON.stringify(state, null, 2));
        }
        catch (err) {
            this.log("error", `doge-wallet: tracking state write failed: ${err.message}`);
        }
    }
}
//# sourceMappingURL=tracker.js.map