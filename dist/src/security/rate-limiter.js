/**
 * DOGE Wallet — Rate Limiter
 *
 * Prevents abuse by limiting the rate of wallet operations.
 * Uses sliding window counters for accurate rate limiting.
 * Now with persistence across restarts.
 *
 * Much limit. Very safe. Wow. 🐕
 */
import * as fs from "node:fs";
import * as path from "node:path";
// ============================================================================
// Default Limits
// ============================================================================
/** Default rate limits by operation type */
export const DEFAULT_RATE_LIMITS = {
    // Wallet operations
    "wallet:init": { maxRequests: 3, windowMs: 60_000 }, // 3 per minute
    "wallet:unlock": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute (brute force protection)
    "wallet:lock": { maxRequests: 10, windowMs: 60_000 }, // 10 per minute
    // Balance/info operations (read-only, higher limit)
    "wallet:balance": { maxRequests: 30, windowMs: 60_000 }, // 30 per minute
    "wallet:address": { maxRequests: 30, windowMs: 60_000 }, // 30 per minute
    "wallet:utxos": { maxRequests: 20, windowMs: 60_000 }, // 20 per minute
    "wallet:history": { maxRequests: 20, windowMs: 60_000 }, // 20 per minute
    // Send operations (stricter limits)
    "send:prepare": { maxRequests: 20, windowMs: 60_000 }, // 20 per minute
    "send:execute": { maxRequests: 10, windowMs: 60_000 }, // 10 per minute
    "send:broadcast": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute
    // Invoice operations
    "invoice:create": { maxRequests: 30, windowMs: 60_000 }, // 30 per minute
    "invoice:lookup": { maxRequests: 60, windowMs: 60_000 }, // 60 per minute
    "invoice:list": { maxRequests: 30, windowMs: 60_000 }, // 30 per minute
    // Approval operations
    "approval:approve": { maxRequests: 10, windowMs: 60_000 }, // 10 per minute
    "approval:deny": { maxRequests: 10, windowMs: 60_000 }, // 10 per minute
    // Admin operations
    "admin:freeze": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute
    "admin:unfreeze": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute
    "admin:export": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute
    // API calls (to blockchain APIs)
    "api:utxo_refresh": { maxRequests: 10, windowMs: 60_000 }, // 10 per minute
    "api:broadcast": { maxRequests: 5, windowMs: 60_000 }, // 5 per minute
    "api:get_tx": { maxRequests: 30, windowMs: 60_000 }, // 30 per minute
    // Default fallback
    "default": { maxRequests: 60, windowMs: 60_000 }, // 60 per minute
};
// ============================================================================
// Rate Limiter
// ============================================================================
export class RateLimiter {
    limits;
    entries;
    log;
    /** Track consecutive denials for backoff */
    consecutiveDenials = new Map();
    /** Path to persist rate limit state */
    statePath = null;
    /** Default window duration for filtering expired entries */
    defaultWindowMs;
    constructor(customLimits, log, dataDir) {
        this.limits = new Map(Object.entries({
            ...DEFAULT_RATE_LIMITS,
            ...customLimits,
        }));
        this.entries = new Map();
        this.log = log ?? (() => { });
        this.defaultWindowMs = DEFAULT_RATE_LIMITS["default"].windowMs;
        // Set up persistence if dataDir provided
        if (dataDir) {
            this.statePath = path.join(dataDir, 'rate-limit-state.json');
            this.loadState();
        }
    }
    /**
     * Load persisted rate limit state from disk.
     * Filters out expired entries during load.
     */
    loadState() {
        if (!this.statePath)
            return;
        try {
            if (fs.existsSync(this.statePath)) {
                const raw = fs.readFileSync(this.statePath, 'utf-8');
                const data = JSON.parse(raw);
                const now = Date.now();
                // Restore state, filtering out expired entries
                for (const [key, entry] of Object.entries(data)) {
                    const operation = key.split(":")[0];
                    const config = this.getConfig(operation);
                    const windowMs = config?.windowMs ?? this.defaultWindowMs;
                    // Only restore if window hasn't expired
                    if (now - entry.windowStart < windowMs) {
                        this.entries.set(key, entry);
                    }
                }
                if (this.entries.size > 0) {
                    this.log("info", `doge-wallet: restored ${this.entries.size} rate limit entries`);
                }
            }
        }
        catch (err) {
            // Ignore load errors - start fresh
            this.log("warn", `doge-wallet: rate limit state load failed, starting fresh`);
        }
    }
    /**
     * Save current rate limit state to disk.
     * Call this on shutdown to persist state across restarts.
     */
    saveState() {
        if (!this.statePath)
            return;
        try {
            const data = {};
            const now = Date.now();
            for (const [key, entry] of this.entries) {
                const operation = key.split(":")[0];
                const config = this.getConfig(operation);
                const windowMs = config?.windowMs ?? this.defaultWindowMs;
                // Only save non-expired entries
                if (now - entry.windowStart < windowMs) {
                    data[key] = entry;
                }
            }
            // Ensure directory exists with secure permissions
            const dir = path.dirname(this.statePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            try {
                fs.chmodSync(dir, 0o700);
            }
            catch { }
            fs.writeFileSync(this.statePath, JSON.stringify(data), { mode: 0o600 });
            try {
                fs.chmodSync(this.statePath, 0o600);
            }
            catch { }
        }
        catch (err) {
            // Log but don't throw - rate limiting still works in-memory
            this.log("warn", `doge-wallet: rate limit state save failed`);
        }
    }
    // --------------------------------------------------------------------------
    // Core Operations
    // --------------------------------------------------------------------------
    /**
     * Check if an operation is allowed under rate limits.
     * Does NOT consume a request slot — use consume() for that.
     *
     * @param operation - Operation type (e.g., "send:execute")
     * @param key - Optional unique key (e.g., user ID, IP address)
     */
    check(operation, key) {
        const fullKey = key ? `${operation}:${key}` : operation;
        const config = this.getConfig(operation);
        const now = Date.now();
        const entry = this.entries.get(fullKey);
        // No entry yet — allowed
        if (!entry) {
            return {
                allowed: true,
                remaining: config.maxRequests,
                resetInMs: config.windowMs,
            };
        }
        // Check if window has expired
        const windowElapsed = now - entry.windowStart;
        if (windowElapsed >= config.windowMs) {
            // Window expired — reset
            return {
                allowed: true,
                remaining: config.maxRequests,
                resetInMs: config.windowMs,
            };
        }
        // Check count
        const remaining = Math.max(0, config.maxRequests - entry.count);
        const resetInMs = config.windowMs - windowElapsed;
        return {
            allowed: remaining > 0,
            remaining,
            resetInMs,
            reason: remaining === 0
                ? `Rate limit exceeded for ${operation}. Try again in ${Math.ceil(resetInMs / 1000)}s.`
                : undefined,
        };
    }
    /**
     * Consume a request slot for an operation.
     * Returns whether the request was allowed.
     *
     * @param operation - Operation type
     * @param key - Optional unique key
     */
    consume(operation, key) {
        const fullKey = key ? `${operation}:${key}` : operation;
        const config = this.getConfig(operation);
        const now = Date.now();
        let entry = this.entries.get(fullKey);
        // Initialize or reset expired window
        if (!entry || (now - entry.windowStart) >= config.windowMs) {
            entry = {
                count: 0,
                windowStart: now,
            };
            this.entries.set(fullKey, entry);
        }
        // Check limit
        if (entry.count >= config.maxRequests) {
            const resetInMs = config.windowMs - (now - entry.windowStart);
            // Track consecutive denials
            const denials = (this.consecutiveDenials.get(fullKey) ?? 0) + 1;
            this.consecutiveDenials.set(fullKey, denials);
            // Log warning for repeated denials
            if (denials >= 3) {
                this.log("warn", `doge-wallet: rate limit hit ${denials}x for ${operation}${key ? ` (${key})` : ""}`);
            }
            return {
                allowed: false,
                remaining: 0,
                resetInMs,
                reason: `Rate limit exceeded for ${operation}. Try again in ${Math.ceil(resetInMs / 1000)}s.`,
            };
        }
        // Consume slot
        entry.count++;
        this.consecutiveDenials.delete(fullKey); // Reset denial counter
        return {
            allowed: true,
            remaining: config.maxRequests - entry.count,
            resetInMs: config.windowMs - (now - entry.windowStart),
        };
    }
    /**
     * Get the configuration for an operation.
     */
    getConfig(operation) {
        return this.limits.get(operation) ?? this.limits.get("default") ?? DEFAULT_RATE_LIMITS["default"];
    }
    /**
     * Update the limit for an operation.
     */
    setLimit(operation, config) {
        this.limits.set(operation, config);
    }
    /**
     * Reset rate limits for an operation (admin override).
     */
    reset(operation, key) {
        const fullKey = key ? `${operation}:${key}` : operation;
        this.entries.delete(fullKey);
        this.consecutiveDenials.delete(fullKey);
    }
    /**
     * Reset all rate limits.
     */
    resetAll() {
        this.entries.clear();
        this.consecutiveDenials.clear();
    }
    /**
     * Get current stats for monitoring.
     */
    getStats() {
        const stats = {};
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            const operation = key.split(":")[0];
            const config = this.getConfig(operation);
            const windowElapsed = now - entry.windowStart;
            if (windowElapsed < config.windowMs) {
                stats[key] = {
                    count: entry.count,
                    windowStart: entry.windowStart,
                    remaining: Math.max(0, config.maxRequests - entry.count),
                };
            }
        }
        return stats;
    }
    /**
     * Clean up expired entries (call periodically).
     */
    cleanup() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.entries) {
            const operation = key.split(":")[0];
            const config = this.getConfig(operation);
            if (now - entry.windowStart >= config.windowMs * 2) {
                this.entries.delete(key);
                this.consecutiveDenials.delete(key);
                cleaned++;
            }
        }
        return cleaned;
    }
}
// ============================================================================
// Helper: Rate limit decorator for async functions
// ============================================================================
/**
 * Wrap an async function with rate limiting.
 *
 * @param rateLimiter - The rate limiter instance
 * @param operation - Operation type
 * @param fn - Function to wrap
 * @param keyFn - Optional function to extract key from args
 */
export function withRateLimit(rateLimiter, operation, fn, keyFn) {
    return (async (...args) => {
        const key = keyFn?.(...args);
        const result = rateLimiter.consume(operation, key);
        if (!result.allowed) {
            throw new RateLimitError(operation, result.resetInMs, result.reason);
        }
        return fn(...args);
    });
}
// ============================================================================
// Rate Limit Error
// ============================================================================
export class RateLimitError extends Error {
    operation;
    resetInMs;
    constructor(operation, resetInMs, message) {
        super(message ?? `Rate limit exceeded for ${operation}`);
        this.name = "RateLimitError";
        this.operation = operation;
        this.resetInMs = resetInMs;
    }
}
//# sourceMappingURL=rate-limiter.js.map