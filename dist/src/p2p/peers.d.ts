/**
 * DOGE Wallet — P2P Peer Discovery
 *
 * Discovers active Dogecoin nodes via DNS seed queries.
 * Selects a randomized subset for broadcast redundancy.
 *
 * Much DNS. Very discovery. Wow. 🐕
 */
export interface PeerInfo {
    /** IPv4 address */
    ip: string;
    /** P2P port */
    port: number;
}
export type LogFn = (level: "info" | "warn" | "error", msg: string) => void;
/**
 * Discover peers by querying DNS seeds.
 *
 * Queries all seeds in parallel, collects unique IPs, shuffles,
 * and returns up to `maxPeers` results.
 *
 * @param network - mainnet or testnet
 * @param maxPeers - Maximum number of peers to return (default: 8)
 * @param log - Optional logger
 * @returns Array of PeerInfo
 */
export declare function discoverPeers(network: "mainnet" | "testnet", maxPeers?: number, log?: LogFn): Promise<PeerInfo[]>;
//# sourceMappingURL=peers.d.ts.map