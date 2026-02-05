/**
 * DOGE Wallet — Rate Limiting / Spend Tracking
 *
 * Tracks daily/hourly spend totals and transaction counts.
 * Persists to disk for restart resilience.
 * Resets daily at midnight UTC.
 *
 * Much limit. Very responsible. Wow. 🐕
 */
import type { SpendingLimits } from "../types.js";
export interface SpendRecord {
    /** Amount in koinu */
    amount: number;
    /** ISO 8601 timestamp */
    timestamp: string;
}
export interface LimitsState {
    version: 1;
    /** Spend records for the current day */
    records: SpendRecord[];
    /** Date string (YYYY-MM-DD) for the current day — used for reset detection */
    currentDay: string;
    /** ISO 8601 timestamp of the last spend */
    lastSpendAt: string | null;
}
export interface LimitCheckResult {
    withinLimits: boolean;
    /** Remaining daily allowance in koinu */
    dailyRemaining: number;
    /** Remaining hourly allowance in koinu */
    hourlyRemaining: number;
    /** Remaining tx count for today */
    txCountRemaining: number;
    /** Human-readable reason if over limit */
    reason?: string;
}
export declare class LimitTracker {
    private readonly filePath;
    private readonly limits;
    private readonly log;
    private records;
    private currentDay;
    private lastSpendAt;
    constructor(dataDir: string, limits: SpendingLimits, log?: (level: "info" | "warn" | "error", msg: string) => void);
    /**
     * Record a spend. Call this after a successful send.
     */
    recordSpend(amountKoinu: number, timestamp?: string): void;
    /**
     * Get the total spent today in koinu.
     */
    getDailySpent(): number;
    /**
     * Get the total spent in the last hour in koinu.
     */
    getHourlySpent(): number;
    /**
     * Get the transaction count for today.
     */
    getTxCountToday(): number;
    /**
     * Check if a proposed spend is within limits.
     *
     * @param amountKoinu - Proposed spend amount in koinu
     * @returns LimitCheckResult
     */
    isWithinLimits(amountKoinu: number): LimitCheckResult;
    /**
     * Check cooldown between sends.
     *
     * @param cooldownSeconds - Minimum seconds between sends
     * @returns true if cooldown has elapsed
     */
    checkCooldown(cooldownSeconds: number): boolean;
    load(): Promise<void>;
    private save;
    private todayStr;
    private resetIfNewDay;
}
//# sourceMappingURL=limits.d.ts.map