/**
 * QP Orchestrator Types
 * Lifecycle coordination for the Quackstro Protocol
 */
import type { DogeApiProvider, UTXO } from '../../types.js';
import type { AdvertiseFlags } from '../types.js';
import type { SideloadConnectionInfo } from '../sideload/types.js';
/** Lifecycle state for a single service call */
export declare enum CallState {
    DISCOVERING = "discovering",
    HANDSHAKING = "handshaking",
    CONNECTING = "connecting",
    REQUESTING = "requesting",
    AWAITING_DELIVERY = "awaiting_delivery",
    PAYING = "paying",
    RATING = "rating",
    COMPLETE = "complete",
    FAILED = "failed"
}
/** Payment settlement method */
export type PaymentMethod = 'htlc' | 'channel';
/** Service request describing what the consumer needs */
export interface ServiceRequest {
    /** Skill code to search for */
    skillCode: number;
    /** Maximum price willing to pay (koinu) */
    maxPriceKoinu: number;
    /** Work request payload (sent via sideload) */
    payload: Buffer | Record<string, unknown>;
    /** Preferred payment method (default: htlc) */
    preferredPayment?: PaymentMethod;
    /** HTLC timeout in blocks (default: 144 ≈ 2.4h) */
    timeoutBlocks?: number;
    /** Optional metadata sent alongside request */
    metadata?: Record<string, unknown>;
}
/** Result from a completed service call */
export interface ServiceResult {
    /** Whether the service was delivered successfully */
    success: boolean;
    /** Response payload from provider */
    response?: Buffer | Record<string, unknown>;
    /** Provider's DOGE address */
    providerAddress: string;
    /** Payment transaction ID (HTLC funding or channel close) */
    paymentTxId?: string;
    /** Rating transaction ID */
    ratingTxId?: string;
    /** HTLC record ID (if paid via HTLC) */
    htlcId?: string;
    /** Channel record ID (if paid via channel) */
    channelId?: string;
    /** Total cost in koinu */
    totalCostKoinu: number;
    /** Wall-clock duration of the entire lifecycle */
    durationMs: number;
}
/** Consumer orchestrator configuration */
export interface OrchestratorConfig {
    /** Our wallet address */
    address: string;
    /** Our compressed public key (33 bytes) */
    pubkey: Buffer;
    /** Our private key (32 bytes) */
    privkey: Buffer;
    /** API provider for chain access */
    provider: DogeApiProvider;
    /** Default handshake timeout (blocks, default 30) */
    handshakeTimeoutBlocks?: number;
    /** Default HTLC timeout (blocks, default 144) */
    htlcTimeoutBlocks?: number;
    /** Default sideload session TTL (ms, default 24h) */
    sessionTtlMs?: number;
    /** Auto-rate after successful service (default true) */
    autoRate?: boolean;
    /** Default rating if auto-rate (1-5, default 5) */
    defaultRating?: number;
    /** UTXO source for building transactions */
    getUtxos: () => Promise<UTXO[]>;
    /** Change address for transaction change outputs */
    changeAddress: string;
}
/** Provider skill registration */
export interface SkillRegistration {
    /** Skill code (uint16) */
    skillCode: number;
    /** Price in koinu */
    priceKoinu: number;
    /** Price unit */
    priceUnit: number;
    /** Human-readable description (max 20 chars for OP_RETURN) */
    description: string;
    /** Capability flags */
    flags: AdvertiseFlags;
    /** Handler function — receives request body, returns response */
    handler: (request: Record<string, unknown>) => Promise<Buffer | Record<string, unknown>>;
}
/** Provider orchestrator configuration */
export interface ProviderConfig extends OrchestratorConfig {
    /** Skills this provider offers */
    skills: SkillRegistration[];
    /** TTL for advertisements (blocks, default 10080 ≈ 7 days) */
    advertiseTtlBlocks?: number;
    /** Scan interval for incoming handshakes (ms, default 60000) */
    scanIntervalMs?: number;
    /** Sideload P2P listen port (default 8443) */
    sideloadPort?: number;
    /** Sideload P2P IPv4 address (default 0.0.0.0) */
    sideloadIpv4?: Buffer;
}
/** Event types emitted during lifecycle */
export type OrchestratorEventType = 'state_change' | 'provider_found' | 'handshake_complete' | 'delivery_received' | 'payment_sent' | 'rated' | 'error';
/** Event emitted during lifecycle */
export interface OrchestratorEvent {
    type: OrchestratorEventType;
    callId: string;
    state: CallState;
    detail?: unknown;
    timestamp: number;
}
/** Active call being orchestrated */
export interface ActiveCall {
    id: string;
    state: CallState;
    request: ServiceRequest;
    providerAddress?: string;
    providerPubkey?: Buffer;
    sessionId?: number;
    sessionKey?: Buffer;
    remoteInfo?: SideloadConnectionInfo;
    paymentTxId?: string;
    htlcId?: string;
    channelId?: string;
    startedAt: number;
    error?: Error;
}
/**
 * Transport interface for sideload communication.
 * The orchestrator encrypts/decrypts messages; the transport sends/receives
 * raw wire bytes over the network.
 *
 * Implementations: HTTPS, libp2p, IPFS (out of scope for SDK).
 */
export interface SideloadTransport {
    /** Send encrypted wire bytes to a remote endpoint */
    send(remoteInfo: SideloadConnectionInfo, wire: Buffer): Promise<void>;
    /** Receive the next incoming wire buffer (blocks until available or timeout) */
    receive(sessionId: number, timeoutMs: number): Promise<Buffer>;
    /** Close the transport for a session */
    close(sessionId: number): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map