/**
 * DOGE Wallet — UTXO Manager
 *
 * Tracks unspent transaction outputs (UTXOs) with on-disk caching,
 * network refresh, locking for in-flight transactions, and balance computation.
 *
 * Much UTXO. Very track. Wow. 🐕
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { UTXO, DogeApiProvider, UtxoCache } from "../types.js";

type LogFn = (level: "info" | "warn" | "error", msg: string) => void;

export class UtxoManager {
  private readonly dataDir: string;
  private readonly cachePath: string;
  private readonly provider: DogeApiProvider;
  private readonly log: LogFn;

  private utxos: UTXO[] = [];
  private lastRefreshed: string | null = null;

  constructor(
    dataDir: string,
    provider: DogeApiProvider,
    log?: LogFn,
  ) {
    this.dataDir = dataDir;
    this.cachePath = join(dataDir, "utxos", "cache.json");
    this.provider = provider;
    this.log = log ?? (() => {});
  }

  /**
   * Load UTXO cache from disk.
   */
  async load(): Promise<void> {
    try {
      if (!existsSync(this.cachePath)) return;
      const raw = readFileSync(this.cachePath, "utf-8");
      const cache = JSON.parse(raw) as UtxoCache;
      if (cache.version === 1 && Array.isArray(cache.utxos)) {
        this.utxos = cache.utxos;
        this.lastRefreshed = cache.lastRefreshed ?? null;
        this.log("info", `doge-wallet: loaded ${this.utxos.length} cached UTXOs`);
      }
    } catch (err) {
      this.log("warn", `doge-wallet: failed to load UTXO cache: ${(err as Error).message}`);
    }
  }

  /**
   * Clear all cached UTXOs.
   */
  clear(): void {
    this.utxos = [];
    this.lastRefreshed = null;
  }

  /**
   * Get all UTXOs (including locked ones).
   */
  getUtxos(): UTXO[] {
    return [...this.utxos];
  }

  /**
   * Get balance breakdown (excludes locked UTXOs from totals).
   */
  getBalance(): { confirmed: number; unconfirmed: number; total: number } {
    let confirmed = 0;
    let unconfirmed = 0;

    for (const u of this.utxos) {
      if (u.locked) continue;
      if (u.confirmations >= 1) {
        confirmed += u.amount;
      } else {
        unconfirmed += u.amount;
      }
    }

    return { confirmed, unconfirmed, total: confirmed + unconfirmed };
  }

  /**
   * Get the last refresh timestamp (ISO 8601) or null.
   */
  getLastRefreshed(): string | null {
    return this.lastRefreshed;
  }

  /**
   * Get spendable UTXOs (unlocked and with enough confirmations).
   */
  async getSpendableUtxos(minConfirmations: number): Promise<UTXO[]> {
    return this.utxos.filter(
      (u) => !u.locked && u.confirmations >= minConfirmations,
    );
  }

  /**
   * Refresh UTXOs from the network provider.
   */
  async refresh(address: string): Promise<void> {
    const networkUtxos = await this.provider.getUtxos(address);

    // Defensive guard: if network returns empty but we had UTXOs cached,
    // this is likely an API error (rate limit, outage). Preserve cached data.
    if (networkUtxos.length === 0 && this.utxos.length > 0) {
      this.log(
        "warn",
        `doge-wallet: refresh returned 0 UTXOs but ${this.utxos.length} cached — skipping update (possible API error)`,
      );
      return;
    }

    // Build map of existing UTXOs to preserve lock state
    const existingMap = new Map<string, UTXO>();
    for (const u of this.utxos) {
      existingMap.set(`${u.txid}:${u.vout}`, u);
    }

    const merged: UTXO[] = [];

    for (const nu of networkUtxos) {
      const key = `${nu.txid}:${nu.vout}`;
      const existing = existingMap.get(key);

      if (existing?.locked) {
        // Preserve lock state for in-flight transactions
        merged.push({
          ...nu,
          locked: true,
          lockedAt: existing.lockedAt,
          lockedFor: existing.lockedFor,
        });
      } else {
        merged.push({ ...nu, locked: nu.locked ?? false });
      }
    }

    this.utxos = merged;
    this.lastRefreshed = new Date().toISOString();
    this.saveCache(address);
    this.log("info", `doge-wallet: refreshed ${merged.length} UTXOs for ${address}`);
  }

  /**
   * Add an optimistic UTXO (e.g., change output from a just-broadcast transaction).
   * Deduplicates by txid:vout.
   */
  async addUtxo(utxo: UTXO): Promise<void> {
    const key = `${utxo.txid}:${utxo.vout}`;
    const exists = this.utxos.some((u) => `${u.txid}:${u.vout}` === key);
    if (!exists) {
      this.utxos.push(utxo);
    }
  }

  /**
   * Mark a UTXO as spent (lock it with the spending txid).
   */
  async markSpent(txid: string, vout: number, spentInTxid: string): Promise<void> {
    const utxo = this.utxos.find((u) => u.txid === txid && u.vout === vout);
    if (utxo) {
      utxo.locked = true;
      utxo.lockedAt = new Date().toISOString();
      utxo.lockedFor = spentInTxid;
    }
  }

  /**
   * Unlock a UTXO (e.g., if the transaction failed).
   */
  async unlockUtxo(txid: string, vout: number): Promise<boolean> {
    const utxo = this.utxos.find((u) => u.txid === txid && u.vout === vout);
    if (utxo && utxo.locked) {
      utxo.locked = false;
      utxo.lockedAt = undefined;
      utxo.lockedFor = undefined;
      return true;
    }
    return false;
  }

  /**
   * Select UTXOs using a selector function and lock the selected ones.
   */
  async selectAndLock<T extends { selected: UTXO[] }>(
    selector: (utxos: UTXO[], target: number) => T,
    targetAmount: number,
  ): Promise<T> {
    const spendable = this.utxos.filter((u) => !u.locked);
    const result = selector(spendable, targetAmount);

    for (const selected of result.selected) {
      await this.markSpent(selected.txid, selected.vout, "pending");
    }

    return result;
  }

  // ---- Private helpers ----

  private saveCache(address: string): void {
    try {
      const dir = join(this.dataDir, "utxos");
      mkdirSync(dir, { recursive: true, mode: 0o700 });

      const balance = this.getBalance();
      const cache: UtxoCache = {
        version: 1,
        address,
        utxos: this.utxos,
        lastRefreshed: this.lastRefreshed ?? new Date().toISOString(),
        confirmedBalance: balance.confirmed,
        unconfirmedBalance: balance.unconfirmed,
      };

      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), {
        mode: 0o600,
      });
    } catch (err) {
      this.log("warn", `doge-wallet: failed to save UTXO cache: ${(err as Error).message}`);
    }
  }
}
