/**
 * DOGE Wallet — BlockCypher API Provider
 *
 * Primary API provider for DOGE blockchain data.
 * Base URL: https://api.blockcypher.com/v1/doge/main
 * Free tier: 200 req/hr (no key), 2000 req/hr (with key)
 *
 * Much BlockCypher. Very reliable. Wow. 🐕
 */
import type { DogeApiProvider, UTXO, Transaction, NetworkInfo } from "../types.js";
import type { BlockCypherConfig } from "../types.js";
export declare class BlockCypherProvider implements DogeApiProvider {
    readonly name = "blockcypher";
    private baseUrl;
    private apiToken;
    constructor(config: BlockCypherConfig);
    /**
     * Generate P2PKH scriptPubKey from a DOGE address.
     * Used when BlockCypher doesn't return the script field.
     * P2PKH script format: OP_DUP OP_HASH160 <20-byte-pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
     * Hex: 76a914 + <40-char-hex-pubKeyHash> + 88ac
     */
    private generateP2PKHScript;
    /** Append API token to URL if configured */
    private url;
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
//# sourceMappingURL=blockcypher.d.ts.map