/**
 * QP Client — Consumer-side Orchestrator
 *
 * Drives the full Quackstro Protocol lifecycle:
 *   discover → handshake → sideload → deliver → pay → rate
 */
import { EventEmitter } from 'node:events';
import type { SideloadConnectionInfo } from '../sideload/types.js';
import { ServiceDirectory } from '../chain/registry-watcher.js';
import type { ServiceListing } from '../chain/types.js';
import { SessionManager } from '../sideload/session-manager.js';
import type { SideloadMessage } from '../sideload/types.js';
import type { OrchestratorConfig, ServiceRequest, ServiceResult, SideloadTransport, PaymentMethod } from './types.js';
export declare class QPClient extends EventEmitter {
    private config;
    private watcher;
    private htlcStorage;
    private htlcManager;
    private activeCalls;
    private destroyed;
    constructor(config: OrchestratorConfig);
    /**
     * Full lifecycle: discover → handshake → sideload → deliver → pay → rate.
     *
     * @param request — what skill we need and how much we'll pay
     * @param transport — how to send/receive sideload wire bytes
     * @returns ServiceResult with response payload and payment details
     */
    callService(request: ServiceRequest, transport: SideloadTransport): Promise<ServiceResult>;
    /**
     * Find providers for a skill code.
     * Scans the on-chain registry, filters by price and flags, sorts by price ascending.
     */
    discoverProviders(skillCode: number, maxPriceKoinu?: number): Promise<ServiceListing[]>;
    /**
     * Initiate ECDH handshake with a provider.
     *
     * 1. Generate ephemeral key pair
     * 2. Compute ECDH shared secret with provider's pubkey
     * 3. Encrypt our P2P connection details
     * 4. Build and broadcast HANDSHAKE_INIT tx
     * 5. Wait for HANDSHAKE_ACK
     * 6. Derive session key from double-ECDH
     *
     * Returns session key + remote connection info for sideload.
     */
    initiateHandshake(provider: ServiceListing): Promise<{
        sessionId: number;
        sessionKey: Buffer;
        remoteInfo: SideloadConnectionInfo;
    }>;
    /**
     * Poll chain for HANDSHAKE_ACK directed at us.
     */
    private waitForHandshakeAck;
    /**
     * Open sideload session and send work request.
     */
    sendRequest(sessionId: number, sessionKey: Buffer, remoteInfo: SideloadConnectionInfo, payload: Buffer | Record<string, unknown>, transport: SideloadTransport): Promise<{
        messageId: string;
        sessionManager: SessionManager;
    }>;
    /**
     * Wait for provider's response via sideload.
     */
    awaitDelivery(sessionManager: SessionManager, messageId: string, transport: SideloadTransport, timeoutMs?: number): Promise<SideloadMessage>;
    /**
     * Pay provider via HTLC.
     *
     * For MVP: direct HTLC only. Channel payments are a future enhancement.
     */
    pay(params: {
        providerAddress: string;
        providerPubkey: Buffer;
        amountKoinu: number;
        method: PaymentMethod;
        sessionId: number;
        skillCode: number;
        channelId?: string;
        deliveryHash?: Buffer;
    }): Promise<{
        txId: string;
        htlcId?: string;
    }>;
    /**
     * Rate a provider on-chain.
     */
    rateProvider(params: {
        providerAddress: string;
        providerPubkey: Buffer;
        sessionId: number;
        skillCode: number;
        paymentTxId: string;
        rating: number;
        tipIncluded?: boolean;
        dispute?: boolean;
    }): Promise<{
        txId: string;
    }>;
    /** Get the service directory (discovered providers) */
    getDirectory(): ServiceDirectory;
    /** Get active call count */
    get activeCallCount(): number;
    /** Clean up: zero keys, release resources */
    destroy(): void;
    private assertNotDestroyed;
    private emitEvent;
}
//# sourceMappingURL=client.d.ts.map