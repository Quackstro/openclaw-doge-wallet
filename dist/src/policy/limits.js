/**
 * DOGE Wallet — Rate Limiting / Spend Tracking
 *
 * Tracks daily/hourly spend totals and transaction counts.
 * Persists to disk for restart resilience.
 * Resets daily at midnight UTC.
 *
 * Much limit. Very responsible. Wow. 🐕
 */
import { readFile } from "node:fs/promises";
import { secureWriteFile } from "../secure-fs.js";
import { join } from "node:path";
import { koinuToDoge } from "../types.js";
// ============================================================================
// LimitTracker
// ============================================================================
export class LimitTracker {
    filePath;
    limits;
    log;
    records = [];
    currentDay;
    lastSpendAt = null;
    constructor(dataDir, limits, log) {
        this.filePath = join(dataDir, "limits.json");
        this.limits = limits;
        this.log = log ?? (() => { });
        this.currentDay = this.todayStr();
    }
    // --------------------------------------------------------------------------
    // Public API
    // --------------------------------------------------------------------------
    /**
     * Record a spend. Call this after a successful send.
     */
    recordSpend(amountKoinu, timestamp) {
        this.resetIfNewDay();
        const ts = timestamp ?? new Date().toISOString();
        this.records.push({ amount: amountKoinu, timestamp: ts });
        this.lastSpendAt = ts;
        this.save().catch(() => { });
    }
    /**
     * Get the total spent today in koinu.
     */
    getDailySpent() {
        this.resetIfNewDay();
        return this.records.reduce((sum, r) => sum + r.amount, 0);
    }
    /**
     * Get the total spent in the last hour in koinu.
     */
    getHourlySpent() {
        this.resetIfNewDay();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        return this.records
            .filter((r) => new Date(r.timestamp).getTime() > oneHourAgo)
            .reduce((sum, r) => sum + r.amount, 0);
    }
    /**
     * Get the transaction count for today.
     */
    getTxCountToday() {
        this.resetIfNewDay();
        return this.records.length;
    }
    /**
     * Check if a proposed spend is within limits.
     *
     * @param amountKoinu - Proposed spend amount in koinu
     * @returns LimitCheckResult
     */
    isWithinLimits(amountKoinu) {
        this.resetIfNewDay();
        const dailyLimitKoinu = this.limits.dailyMax * 1e8;
        const hourlyLimitKoinu = this.limits.hourlyMax * 1e8;
        const dailySpent = this.getDailySpent();
        const hourlySpent = this.getHourlySpent();
        const txCount = this.getTxCountToday();
        const dailyRemaining = dailyLimitKoinu - dailySpent;
        const hourlyRemaining = hourlyLimitKoinu - hourlySpent;
        const txCountRemaining = this.limits.txCountDailyMax - txCount;
        // Check daily limit
        if (dailySpent + amountKoinu > dailyLimitKoinu) {
            return {
                withinLimits: false,
                dailyRemaining,
                hourlyRemaining,
                txCountRemaining,
                reason: `Daily limit exceeded: spent ${koinuToDoge(dailySpent)} / ${this.limits.dailyMax} DOGE today. ` +
                    `This send would put you over. Much limit. 🛑`,
            };
        }
        // Check hourly limit
        if (hourlySpent + amountKoinu > hourlyLimitKoinu) {
            return {
                withinLimits: false,
                dailyRemaining,
                hourlyRemaining,
                txCountRemaining,
                reason: `Hourly limit exceeded: spent ${koinuToDoge(hourlySpent)} / ${this.limits.hourlyMax} DOGE this hour. ` +
                    `Slow down. Much speed. 🛑`,
            };
        }
        // Check tx count
        if (txCount >= this.limits.txCountDailyMax) {
            return {
                withinLimits: false,
                dailyRemaining,
                hourlyRemaining,
                txCountRemaining,
                reason: `Transaction count limit reached: ${txCount} / ${this.limits.txCountDailyMax} txs today. ` +
                    `No more sends until tomorrow. 🛑`,
            };
        }
        return {
            withinLimits: true,
            dailyRemaining,
            hourlyRemaining,
            txCountRemaining,
        };
    }
    /**
     * Check cooldown between sends.
     *
     * @param cooldownSeconds - Minimum seconds between sends
     * @returns true if cooldown has elapsed
     */
    checkCooldown(cooldownSeconds) {
        if (!this.lastSpendAt)
            return true;
        const elapsed = (Date.now() - new Date(this.lastSpendAt).getTime()) / 1000;
        return elapsed >= cooldownSeconds;
    }
    // --------------------------------------------------------------------------
    // Persistence
    // --------------------------------------------------------------------------
    async load() {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const state = JSON.parse(raw);
            if (state.version !== 1) {
                this.log("warn", "doge-wallet: limits state version mismatch, starting fresh");
                return;
            }
            this.records = state.records ?? [];
            this.currentDay = state.currentDay ?? this.todayStr();
            this.lastSpendAt = state.lastSpendAt ?? null;
            // Reset if it's a new day
            this.resetIfNewDay();
            this.log("info", `doge-wallet: limits loaded — ${this.records.length} records for ${this.currentDay}`);
        }
        catch (err) {
            const e = err;
            if (e.code !== "ENOENT") {
                this.log("warn", `doge-wallet: limits state read failed: ${e.message}`);
            }
        }
    }
    async save() {
        const state = {
            version: 1,
            records: this.records,
            currentDay: this.currentDay,
            lastSpendAt: this.lastSpendAt,
        };
        try {
            await secureWriteFile(this.filePath, JSON.stringify(state, null, 2));
        }
        catch (err) {
            this.log("error", `doge-wallet: limits state write failed: ${err.message}`);
        }
    }
    // --------------------------------------------------------------------------
    // Helpers
    // --------------------------------------------------------------------------
    todayStr() {
        return new Date().toISOString().slice(0, 10);
    }
    resetIfNewDay() {
        const today = this.todayStr();
        if (this.currentDay !== today) {
            this.log("info", `doge-wallet: new day detected (${this.currentDay} → ${today}), resetting daily limits`);
            this.records = [];
            this.currentDay = today;
            this.save().catch(() => { });
        }
    }
}
//# sourceMappingURL=limits.js.map