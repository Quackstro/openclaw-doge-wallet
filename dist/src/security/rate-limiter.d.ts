/**
 * DOGE Wallet — Rate Limiter
 *
 * Prevents abuse by limiting the rate of wallet operations.
 * Uses sliding window counters for accurate rate limiting.
 * Now with persistence across restarts.
 *
 * Much limit. Very safe. Wow. 🐕
 */
export interface RateLimitConfig {
    /** Maximum requests per window */
    maxRequests: number;
    /** Window duration in milliseconds */
    windowMs: number;
}
export interface RateLimitEntry {
    /** Request count in current window */
    count: number;
    /** Window start timestamp */
    windowStart: number;
}
export interface RateLimitResult {
    /** Whether the request is allowed */
    allowed: boolean;
    /** Remaining requests in current window */
    remaining: number;
    /** Time until window reset (ms) */
    resetInMs: number;
    /** Reason if denied */
    reason?: string;
}
/** Default rate limits by operation type */
export declare const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig>;
export declare class RateLimiter {
    private limits;
    private entries;
    private readonly log;
    /** Track consecutive denials for backoff */
    private consecutiveDenials;
    /** Path to persist rate limit state */
    private statePath;
    /** Default window duration for filtering expired entries */
    private readonly defaultWindowMs;
    constructor(customLimits?: Record<string, RateLimitConfig>, log?: (level: "info" | "warn" | "error", msg: string) => void, dataDir?: string);
    /**
     * Load persisted rate limit state from disk.
     * Filters out expired entries during load.
     */
    private loadState;
    /**
     * Save current rate limit state to disk.
     * Call this on shutdown to persist state across restarts.
     */
    saveState(): void;
    /**
     * Check if an operation is allowed under rate limits.
     * Does NOT consume a request slot — use consume() for that.
     *
     * @param operation - Operation type (e.g., "send:execute")
     * @param key - Optional unique key (e.g., user ID, IP address)
     */
    check(operation: string, key?: string): RateLimitResult;
    /**
     * Consume a request slot for an operation.
     * Returns whether the request was allowed.
     *
     * @param operation - Operation type
     * @param key - Optional unique key
     */
    consume(operation: string, key?: string): RateLimitResult;
    /**
     * Get the configuration for an operation.
     */
    getConfig(operation: string): RateLimitConfig;
    /**
     * Update the limit for an operation.
     */
    setLimit(operation: string, config: RateLimitConfig): void;
    /**
     * Reset rate limits for an operation (admin override).
     */
    reset(operation: string, key?: string): void;
    /**
     * Reset all rate limits.
     */
    resetAll(): void;
    /**
     * Get current stats for monitoring.
     */
    getStats(): Record<string, {
        count: number;
        windowStart: number;
        remaining: number;
    }>;
    /**
     * Clean up expired entries (call periodically).
     */
    cleanup(): number;
}
/**
 * Wrap an async function with rate limiting.
 *
 * @param rateLimiter - The rate limiter instance
 * @param operation - Operation type
 * @param fn - Function to wrap
 * @param keyFn - Optional function to extract key from args
 */
export declare function withRateLimit<T extends (...args: any[]) => Promise<any>>(rateLimiter: RateLimiter, operation: string, fn: T, keyFn?: (...args: Parameters<T>) => string | undefined): T;
export declare class RateLimitError extends Error {
    readonly operation: string;
    readonly resetInMs: number;
    constructor(operation: string, resetInMs: number, message?: string);
}
//# sourceMappingURL=rate-limiter.d.ts.map