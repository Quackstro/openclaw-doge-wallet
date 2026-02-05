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

export class PriceService {
  private config: PriceApiConfig;
  private cache: PriceData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private log: (level: "info" | "warn" | "error", msg: string) => void;

  constructor(
    config: PriceApiConfig,
    log?: (level: "info" | "warn" | "error", msg: string) => void,
  ) {
    this.config = config;
    this.log = log ?? (() => {});
  }

  /** Get cached DOGE price in USD, or null if unavailable */
  getPrice(): number | null {
    if (!this.cache) return null;

    // Check if cache is still valid
    const age = (Date.now() - this.cache.fetchedAt) / 1000;
    if (age > this.config.cacheTtlSeconds * 2) {
      // Cache is very stale (> 2x TTL) — still return it but log warning
      this.log("warn", `doge-wallet: price cache is ${Math.round(age)}s old (TTL: ${this.config.cacheTtlSeconds}s)`);
    }

    return this.cache.usd;
  }

  /** Fetch fresh price from CoinGecko */
  async fetchPrice(): Promise<number | null> {
    const url = `${this.config.baseUrl}/simple/price?ids=dogecoin&vs_currencies=usd`;

    try {
      const res = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });

      if (!res.ok) {
        this.log("warn", `doge-wallet: CoinGecko price fetch failed (HTTP ${res.status})`);
        return this.cache?.usd ?? null;
      }

      const data = (await res.json()) as { dogecoin?: { usd?: number } };
      const usd = data?.dogecoin?.usd;

      if (typeof usd !== "number" || usd <= 0) {
        this.log("warn", "doge-wallet: CoinGecko returned invalid price data");
        return this.cache?.usd ?? null;
      }

      this.cache = { usd, fetchedAt: Date.now() };
      return usd;
    } catch (err: any) {
      this.log("warn", `doge-wallet: price fetch error: ${err.message ?? err}`);
      return this.cache?.usd ?? null;
    }
  }

  /** Start periodic price refresh */
  start(): void {
    // Fetch immediately
    this.fetchPrice().catch(() => {});

    // Then refresh on interval
    this.refreshTimer = setInterval(
      () => this.fetchPrice().catch(() => {}),
      this.config.cacheTtlSeconds * 1000,
    );

    // Unref the timer so it doesn't keep the process alive
    if (this.refreshTimer && typeof this.refreshTimer.unref === "function") {
      this.refreshTimer.unref();
    }

    this.log("info", `doge-wallet: price service started (refresh every ${this.config.cacheTtlSeconds}s)`);
  }

  /** Stop periodic price refresh */
  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.log("info", "doge-wallet: price service stopped");
  }

  /** Convert DOGE amount to USD */
  dogeToUsd(doge: number): number | null {
    const price = this.getPrice();
    if (price === null) return null;
    return Math.round(doge * price * 100) / 100;
  }

  /** Format DOGE amount with USD value */
  formatDogeWithUsd(doge: number): string {
    const usd = this.dogeToUsd(doge);
    if (usd !== null) {
      return `${doge.toLocaleString()} DOGE (~$${usd.toFixed(2)})`;
    }
    return `${doge.toLocaleString()} DOGE`;
  }
}
