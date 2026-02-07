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
import type { DogeApiProvider } from "./types.js";
export interface IncomingTx {
    txid: string;
    fromAddress: string;
    amountKoinu: number;
    confirmations: number;
    timestamp?: string;
}
export interface ReceiveCallbacks {
    /** Called when a new incoming transaction is detected */
    onReceive?: (tx: IncomingTx) => void;
}
export declare class ReceiveMonitor {
    private readonly statePath;
    private readonly provider;
    private readonly log;
    private readonly callbacks;
    private readonly pollIntervalMs;
    private seenTxids;
    private lastPollAt;
    private pollTimer;
    private address;
    private consecutiveFailures;
    private readonly maxBackoffMs;
    constructor(dataDir: string, provider: DogeApiProvider, callbacks?: ReceiveCallbacks, log?: (level: "info" | "warn" | "error", msg: string) => void, pollIntervalMs?: number);
    /**
     * Set the wallet address to monitor.
     */
    setAddress(address: string): void;
    /**
     * Start monitoring for incoming transactions.
     */
    start(): void;
    /**
     * Poll once then schedule next with exponential backoff on failure.
     */
    private pollOnce;
    /**
     * Schedule next poll with exponential backoff.
     */
    private scheduleNext;
    /**
     * Stop monitoring.
     */
    stop(): void;
    /**
     * Poll for new incoming transactions.
     */
    poll(): Promise<void>;
    /**
     * From a list of transactions, find incoming ones:
     * wallet address is in outputs but NOT in inputs.
     */
    private detectIncoming;
    load(): Promise<void>;
    private save;
}
//# sourceMappingURL=receive-monitor.d.ts.map