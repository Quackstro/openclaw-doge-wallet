/**
 * DOGE Wallet — P2P Transaction Broadcaster
 *
 * Broadcasts signed transactions directly to the Dogecoin P2P network.
 * No API keys, no rate limits, no third-party dependency.
 *
 * Flow per peer:
 *   1. TCP connect (5s timeout)
 *   2. Send version message
 *   3. Wait for version + verack (10s timeout)
 *   4. Send verack in response
 *   5. Send tx message
 *   6. Brief pause for propagation, then disconnect
 *
 * Much decentralized. Very P2P. Wow. 🐕
 */
export type LogFn = (level: "info" | "warn" | "error", msg: string) => void;
export interface P2PBroadcastResult {
    /** Whether at least one peer accepted the tx relay */
    success: boolean;
    /** Number of peers that completed the handshake + tx send */
    peersReached: number;
}
/**
 * Broadcast a signed transaction to the Dogecoin P2P network.
 *
 * Discovers peers via DNS seeds, connects to multiple nodes,
 * performs the version handshake, and relays the raw transaction.
 *
 * @param signedTxHex - Hex-encoded signed transaction
 * @param network - "mainnet" or "testnet"
 * @param log - Optional logger function
 * @returns P2PBroadcastResult
 */
export declare function broadcastViaP2P(signedTxHex: string, network: "mainnet" | "testnet", log?: LogFn): Promise<P2PBroadcastResult>;
//# sourceMappingURL=broadcaster.d.ts.map