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
import type { DogeApiProvider } from "../types.js";
export type TxStatus = "pending" | "confirming" | "confirmed" | "failed" | "unverified";
export interface TrackedTransaction {
    txid: string;
    status: TxStatus;
    confirmations: number;
    /** When we started tracking */
    startedAt: string;
    /** When last polled */
    lastCheckedAt: string;
    /** When status reached "confirmed" */
    confirmedAt?: string;
    /** When status reached "failed" */
    failedAt?: string;
    /** When status reached "unverified" */
    unverifiedAt?: string;
    /** Reason for failure or unverified status */
    failReason?: string;
    /** Number of consecutive poll failures (real "not found" errors only) */
    pollFailures: number;
    /** Number of consecutive API/rate-limit errors (not counted as tx failures) */
    apiErrors: number;
    /** Associated metadata */
    to?: string;
    amount?: number;
    fee?: number;
}
export interface TrackerCallbacks {
    /** Called when confirmation count changes */
    onConfirmation?: (txid: string, count: number) => void;
    /** Called when tx reaches 6+ confirmations */
    onConfirmed?: (txid: string) => void;
    /** Called when tx is considered failed (real not-found) */
    onFailed?: (txid: string, reason: string) => void;
    /** Called when tx cannot be verified due to API degradation — softer than failed */
    onUnverified?: (txid: string, reason: string) => void;
}
export declare class TransactionTracker {
    private readonly filePath;
    private readonly provider;
    private readonly log;
    private readonly callbacks;
    private readonly basePollIntervalMs;
    private tracked;
    private pollTimer;
    private loaded;
    /** Current effective poll interval — increases on API degradation, resets on success */
    private currentPollIntervalMs;
    constructor(dataDir: string, provider: DogeApiProvider, callbacks?: TrackerCallbacks, log?: (level: "info" | "warn" | "error", msg: string) => void, pollIntervalMs?: number);
    /**
     * Start tracking a transaction.
     */
    track(txid: string, metadata?: {
        to?: string;
        amount?: number;
        fee?: number;
    }): TrackedTransaction;
    /**
     * Get the status of a tracked transaction.
     */
    getStatus(txid: string): TrackedTransaction | undefined;
    /**
     * Get all actively tracked transactions.
     */
    getActive(): TrackedTransaction[];
    /**
     * Get all tracked transactions (including completed).
     */
    getAll(): TrackedTransaction[];
    /**
     * Remove a transaction from tracking.
     */
    remove(txid: string): boolean;
    /**
     * Poll all active transactions for confirmation updates.
     */
    pollAll(): Promise<void>;
    /**
     * Poll a single transaction for confirmation status.
     * Classifies errors as API-degraded vs real tx failures. Much smart. 🐕
     */
    private pollOne;
    /**
     * Double the poll interval (up to MAX_BACKOFF_MS) when APIs are degraded.
     * Restarts the polling timer with the new interval. Much patience. 🐕
     */
    private increasePollInterval;
    /**
     * Reset the poll interval back to baseline after a successful poll.
     */
    private resetPollInterval;
    /**
     * Restart the poll timer with the current interval.
     */
    private restartPolling;
    startPolling(): void;
    stopPolling(): void;
    load(): Promise<void>;
    private save;
}
//# sourceMappingURL=tracker.d.ts.map