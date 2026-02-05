/**
 * DOGE Wallet — Transaction Broadcaster
 *
 * Broadcasts signed transactions to the Dogecoin network with retry logic.
 * Uses the failover provider for resilience.
 *
 * Retry: 3 attempts with exponential backoff (1s, 3s, 9s).
 * Handles: already-broadcast (idempotent), double-spend, fee-too-low.
 *
 * Much broadcast. Very network. Wow. 🐕
 */
import type { DogeApiProvider } from "../types.js";
export interface BroadcastResult {
    /** Transaction ID */
    txid: string;
    /** Whether broadcast was successful */
    success: boolean;
    /** Number of attempts made */
    attempts: number;
    /** Provider that successfully broadcast the tx */
    provider?: string;
}
export interface BroadcastOptions {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Base delay between retries in ms (default: 1000) — multiplied by 3 each retry */
    baseDelayMs?: number;
    /** Whether to verify the tx appears on network after broadcast (default: false) */
    verifyOnNetwork?: boolean;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
/**
 * Broadcast a signed transaction to the Dogecoin network.
 *
 * @param signedTxHex - Signed transaction hex
 * @param provider - API provider (typically the failover provider)
 * @param options - Broadcast options
 * @returns BroadcastResult
 * @throws WalletError on permanent failure (double-spend, fee-too-low)
 */
export declare function broadcastTransaction(signedTxHex: string, provider: DogeApiProvider, options?: BroadcastOptions): Promise<BroadcastResult>;
/**
 * Verify that a transaction appears on the network.
 * Used after broadcast to confirm the tx was accepted.
 *
 * @param txid - Transaction ID to verify
 * @param provider - API provider
 * @param timeoutMs - Max time to wait in ms (default: 30000)
 * @param pollIntervalMs - Time between polls in ms (default: 5000)
 * @returns true if the tx was found on the network
 */
export declare function verifyBroadcast(txid: string, provider: DogeApiProvider, timeoutMs?: number, pollIntervalMs?: number): Promise<boolean>;
//# sourceMappingURL=broadcaster.d.ts.map