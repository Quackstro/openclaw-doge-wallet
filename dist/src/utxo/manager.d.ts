/**
 * DOGE Wallet — UTXO Manager
 *
 * Tracks unspent transaction outputs (UTXOs) with on-disk caching,
 * network refresh, locking for in-flight transactions, and balance computation.
 *
 * Much UTXO. Very track. Wow. 🐕
 */
import type { UTXO, DogeApiProvider } from "../types.js";
type LogFn = (level: "info" | "warn" | "error", msg: string) => void;
export declare class UtxoManager {
    private readonly dataDir;
    private readonly cachePath;
    private readonly provider;
    private readonly log;
    private utxos;
    private lastRefreshed;
    constructor(dataDir: string, provider: DogeApiProvider, log?: LogFn);
    /**
     * Load UTXO cache from disk.
     */
    load(): Promise<void>;
    /**
     * Clear all cached UTXOs.
     */
    clear(): void;
    /**
     * Get all UTXOs (including locked ones).
     */
    getUtxos(): UTXO[];
    /**
     * Get balance breakdown (excludes locked UTXOs from totals).
     */
    getBalance(): {
        confirmed: number;
        unconfirmed: number;
        total: number;
    };
    /**
     * Get the last refresh timestamp (ISO 8601) or null.
     */
    getLastRefreshed(): string | null;
    /**
     * Get spendable UTXOs (unlocked and with enough confirmations).
     */
    getSpendableUtxos(minConfirmations: number): Promise<UTXO[]>;
    /**
     * Refresh UTXOs from the network provider.
     */
    refresh(address: string): Promise<void>;
    /**
     * Add an optimistic UTXO (e.g., change output from a just-broadcast transaction).
     * Deduplicates by txid:vout.
     */
    addUtxo(utxo: UTXO): Promise<void>;
    /**
     * Mark a UTXO as spent (lock it with the spending txid).
     */
    markSpent(txid: string, vout: number, spentInTxid: string): Promise<void>;
    /**
     * Unlock a UTXO (e.g., if the transaction failed).
     */
    unlockUtxo(txid: string, vout: number): Promise<boolean>;
    /**
     * Select UTXOs using a selector function and lock the selected ones.
     */
    selectAndLock<T extends {
        selected: UTXO[];
    }>(selector: (utxos: UTXO[], target: number) => T, targetAmount: number): Promise<T>;
    private saveCache;
}
export {};
//# sourceMappingURL=manager.d.ts.map