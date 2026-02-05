/**
 * DOGE Wallet — Low Balance Alert State Manager
 *
 * Tracks dismiss/snooze state for low balance notifications.
 * Persists to disk so state survives restarts.
 *
 * Much state. Very remember. Wow. 🐕
 */
export interface LowBalanceAlertState {
    /** User dismissed the alert — don't notify until balance recovers */
    dismissed: boolean;
    /** Timestamp (ms) when snooze expires, null if not snoozed */
    snoozedUntil: number | null;
    /** Last balance when we decided to alert (to detect recovery) */
    lastAlertedBalance: number | null;
    /** Threshold that was active when dismissed (for reset detection) */
    dismissedAtThreshold: number | null;
    /** Timestamp (ms) when last notification was sent */
    lastNotifiedAt: number | null;
}
export declare class AlertStateManager {
    private readonly statePath;
    private state;
    private loaded;
    private readonly log;
    constructor(dataDir: string, log?: (level: 'info' | 'warn' | 'error', msg: string) => void);
    load(): Promise<void>;
    private save;
    /**
     * Check if we should send a low balance alert.
     * Returns false if dismissed or currently snoozed.
     * Note: Does NOT check the interval — use shouldAlertWithInterval for that.
     */
    shouldAlert(): boolean;
    /**
     * Check if we should send a low balance alert, including interval check.
     * @param intervalHours Hours between notifications (0 = no rate limiting)
     */
    shouldAlertWithInterval(intervalHours: number): boolean;
    /**
     * Get time until next allowed notification.
     * @param intervalHours Hours between notifications
     * @returns Milliseconds until next alert, or 0 if allowed now
     */
    getTimeUntilNextAlert(intervalHours: number): number;
    /**
     * Get current state (for debugging/status).
     */
    getState(): Readonly<LowBalanceAlertState>;
    /**
     * Mark the alert as dismissed.
     * Won't alert again until balance recovers above threshold.
     */
    dismiss(currentBalance: number, threshold: number): Promise<void>;
    /**
     * Snooze the alert for a duration.
     */
    snooze(durationMs: number, currentBalance: number): Promise<void>;
    /**
     * Record that we sent an alert (for tracking purposes).
     */
    recordAlert(balance: number): Promise<void>;
    /**
     * Check if balance recovered above threshold and reset dismissed state.
     * Call this when balance is checked/updated.
     * Returns true if state was reset (balance recovered).
     */
    checkRecovery(currentBalance: number, threshold: number): Promise<boolean>;
    /**
     * Force reset all state (for testing/manual reset).
     */
    reset(): Promise<void>;
}
export declare const SNOOZE_DURATIONS: {
    readonly '1h': number;
    readonly '24h': number;
};
export type SnoozeDuration = keyof typeof SNOOZE_DURATIONS;
//# sourceMappingURL=alert-state.d.ts.map