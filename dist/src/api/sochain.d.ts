/**
 * DOGE Wallet — SoChain API Provider (v3)
 *
 * Fallback API provider with testnet support.
 * Base URL: https://chain.so/api/v3
 * NOTE: SoChain v3 requires a paid API key. Get one at https://chain.so/api.
 * Testnet network: DOGETEST
 *
 * Much fallback. Very resilient. Wow. 🐕
 */
import type { DogeApiProvider, UTXO, Transaction, NetworkInfo } from "../types.js";
import type { SoChainConfig } from "../types.js";
export declare class SoChainProvider implements DogeApiProvider {
    readonly name = "sochain";
    private baseUrl;
    private apiKey;
    private network;
    constructor(config: SoChainConfig, network?: "mainnet" | "testnet");
    /** Build headers including API key if configured */
    private get headers();
    /** Make a GET request with error handling */
    private get;
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
}
//# sourceMappingURL=sochain.d.ts.map