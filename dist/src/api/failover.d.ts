/**
 * DOGE Wallet — Multi-Provider Failover
 *
 * Try primary provider first, fall back to secondary on failure.
 * Health tracking prevents hammering unhealthy providers.
 *
 * Much resilient. Very failover. Wow. 🐕
 */
import type { DogeApiProvider, UTXO, Transaction, NetworkInfo } from "../types.js";
import { type ProviderHealth } from "./provider.js";
export interface FailoverProviderOptions {
    primary: DogeApiProvider;
    fallback?: DogeApiProvider;
    /** How long a provider stays unhealthy after a failure (ms). Default: 60000 */
    unhealthyDurationMs?: number;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
export declare class FailoverProvider implements DogeApiProvider {
    readonly name = "failover";
    private primary;
    private fallback;
    private primaryHealth;
    private fallbackHealth;
    private log;
    constructor(opts: FailoverProviderOptions);
    /** Execute a method with failover logic */
    private withFailover;
    getBalance(address: string): Promise<{
        confirmed: number;
        unconfirmed: number;
    }>;
    getUtxos(address: string): Promise<UTXO[]>;
    getTransaction(txid: string): Promise<Transaction>;
    getTransactions(address: string, limit: number): Promise<Transaction[]>;
    broadcastTx(rawHex: string): Promise<{
        txid: string;
    }>;
    getNetworkInfo(): Promise<NetworkInfo>;
    /** Get current health status of all providers */
    getHealthStatus(): {
        primary: ProviderHealth;
        fallback?: ProviderHealth;
    };
}
//# sourceMappingURL=failover.d.ts.map