/**
 * DOGE Wallet — Price Fetching Service
 *
 * Fetches DOGE/USD price from CoinGecko with caching.
 * Graceful failure — returns cached price or null if API is down.
 *
 * Much price. Very volatile. Wow. 🐕
 */
import type { PriceApiConfig } from "./types.js";
export interface PriceData {
    usd: number;
    fetchedAt: number;
}
export declare class PriceService {
    private config;
    private cache;
    private refreshTimer;
    private log;
    constructor(config: PriceApiConfig, log?: (level: "info" | "warn" | "error", msg: string) => void);
    /** Get cached DOGE price in USD, or null if unavailable */
    getPrice(): number | null;
    /** Fetch fresh price from CoinGecko */
    fetchPrice(): Promise<number | null>;
    /** Start periodic price refresh */
    start(): void;
    /** Stop periodic price refresh */
    stop(): void;
    /** Convert DOGE amount to USD */
    dogeToUsd(doge: number): number | null;
    /** Format DOGE amount with USD value */
    formatDogeWithUsd(doge: number): string;
}
//# sourceMappingURL=price.d.ts.map