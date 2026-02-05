/**
 * DOGE Wallet — Multi-Provider Failover
 *
 * Try primary provider first, fall back to secondary on failure.
 * Health tracking prevents hammering unhealthy providers.
 *
 * Much resilient. Very failover. Wow. 🐕
 */

import type { DogeApiProvider, UTXO, Transaction, NetworkInfo } from "../types.js";
import {
  type ProviderHealth,
  createProviderHealth,
  markProviderFailed,
  markProviderSuccess,
  isProviderHealthy,
} from "./provider.js";
import { ProviderUnavailableError } from "../errors.js";

export interface FailoverProviderOptions {
  primary: DogeApiProvider;
  fallback?: DogeApiProvider;
  /** How long a provider stays unhealthy after a failure (ms). Default: 60000 */
  unhealthyDurationMs?: number;
  /** Logger function */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export class FailoverProvider implements DogeApiProvider {
  readonly name = "failover";
  private primary: DogeApiProvider;
  private fallback: DogeApiProvider | undefined;
  private primaryHealth: ProviderHealth;
  private fallbackHealth: ProviderHealth | undefined;
  private log: (level: "info" | "warn" | "error", msg: string) => void;

  constructor(opts: FailoverProviderOptions) {
    this.primary = opts.primary;
    this.fallback = opts.fallback;
    const dur = opts.unhealthyDurationMs ?? 60_000;
    this.primaryHealth = createProviderHealth(opts.primary.name, dur);
    if (opts.fallback) {
      this.fallbackHealth = createProviderHealth(opts.fallback.name, dur);
    }
    this.log = opts.log ?? (() => {});
  }

  /** Execute a method with failover logic */
  private async withFailover<T>(
    method: string,
    fn: (provider: DogeApiProvider) => Promise<T>,
  ): Promise<T> {
    const providers: Array<{ provider: DogeApiProvider; health: ProviderHealth }> = [];

    // Add healthy providers first (prefer healthy ones)
    if (isProviderHealthy(this.primaryHealth)) {
      providers.push({ provider: this.primary, health: this.primaryHealth });
    }
    if (this.fallback && this.fallbackHealth && isProviderHealthy(this.fallbackHealth)) {
      providers.push({ provider: this.fallback, health: this.fallbackHealth });
    }

    // Add unhealthy providers at the end as last resort
    // This ensures we always try both providers, even if one was recently marked unhealthy
    if (!isProviderHealthy(this.primaryHealth)) {
      providers.push({ provider: this.primary, health: this.primaryHealth });
    }
    if (this.fallback && this.fallbackHealth && !isProviderHealthy(this.fallbackHealth)) {
      providers.push({ provider: this.fallback, health: this.fallbackHealth });
    }

    if (providers.length === 0) {
      throw new ProviderUnavailableError([this.primary.name, this.fallback?.name ?? "none"]);
    }

    // Log which providers will be tried
    const providerNames = providers.map((p) => {
      const healthStatus = isProviderHealthy(p.health) ? "healthy" : "unhealthy";
      return `${p.provider.name}(${healthStatus})`;
    });
    this.log("info", `doge-wallet: ${method} — trying providers: [${providerNames.join(", ")}]`);

    let lastError: Error | undefined;
    for (let i = 0; i < providers.length; i++) {
      const { provider, health } = providers[i];
      const isLastProvider = i === providers.length - 1;

      try {
        this.log("info", `doge-wallet: ${method} — attempting ${provider.name}...`);
        const result = await fn(provider);
        markProviderSuccess(health);
        this.log("info", `doge-wallet: ${method} — ${provider.name} succeeded`);
        return result;
      } catch (err: any) {
        lastError = err;
        markProviderFailed(health, err.message ?? String(err));
        this.log(
          "warn",
          `doge-wallet: ${provider.name}.${method} failed: ${err.message ?? err}. ` +
            (isLastProvider ? "No more providers." : "Trying next provider..."),
        );
      }
    }

    throw lastError ?? new ProviderUnavailableError([this.primary.name]);
  }

  async getBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    return this.withFailover("getBalance", (p) => p.getBalance(address));
  }

  async getUtxos(address: string): Promise<UTXO[]> {
    return this.withFailover("getUtxos", (p) => p.getUtxos(address));
  }

  async getTransaction(txid: string): Promise<Transaction> {
    return this.withFailover("getTransaction", (p) => p.getTransaction(txid));
  }

  async getTransactions(address: string, limit: number): Promise<Transaction[]> {
    return this.withFailover("getTransactions", (p) => p.getTransactions(address, limit));
  }

  async broadcastTx(rawHex: string): Promise<{ txid: string }> {
    return this.withFailover("broadcastTx", (p) => p.broadcastTx(rawHex));
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    return this.withFailover("getNetworkInfo", (p) => p.getNetworkInfo());
  }

  /** Get current health status of all providers */
  getHealthStatus(): { primary: ProviderHealth; fallback?: ProviderHealth } {
    return {
      primary: { ...this.primaryHealth },
      fallback: this.fallbackHealth ? { ...this.fallbackHealth } : undefined,
    };
  }
}
