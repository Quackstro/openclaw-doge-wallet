/**
 * QP Provider — Service provider handler
 *
 * Advertises skills on-chain, handles incoming handshakes,
 * processes sideload requests, and claims payments.
 */
import { EventEmitter } from 'node:events';
import type { SideloadConnectionInfo } from '../sideload/types.js';
import type { OnChainQPMessage } from '../chain/types.js';
import { SessionManager } from '../sideload/session-manager.js';
import type { ProviderConfig, SideloadTransport } from './types.js';
interface ActiveSession {
    sessionId: number;
    sessionKey: Buffer;
    remoteInfo: SideloadConnectionInfo;
    consumerAddress: string;
    consumerPubkey?: Buffer;
    sessionManager: SessionManager;
    skillCode?: number;
    createdAt: number;
}
export declare class QPProvider extends EventEmitter {
    private config;
    private htlcStorage;
    private htlcManager;
    private sessions;
    private skillHandlers;
    private scanTimer?;
    private running;
    private destroyed;
    constructor(config: ProviderConfig);
    /**
     * Advertise all registered skills on-chain.
     * Broadcasts one SERVICE_ADVERTISE tx per skill to the appropriate registry.
     * Returns the list of transaction IDs.
     */
    advertise(): Promise<string[]>;
    /**
     * Start listening for incoming handshakes.
     * Periodically scans the chain for HANDSHAKE_INIT messages directed at us.
     */
    start(): void;
    /** Stop listening */
    stop(): void;
    /**
     * Scan for incoming HANDSHAKE_INIT messages and respond.
     */
    scanForHandshakes(): Promise<void>;
    /**
     * Handle an incoming HANDSHAKE_INIT message.
     *
     * 1. Decrypt consumer's P2P details using our long-term key
     * 2. Generate our own ephemeral key pair
     * 3. Compute session key via double ECDH
     * 4. Encrypt our P2P details
     * 5. Broadcast HANDSHAKE_ACK
     * 6. Store session for future sideload communication
     */
    handleHandshakeInit(msg: OnChainQPMessage): Promise<void>;
    /**
     * Process an incoming encrypted sideload request.
     * Decrypts, dispatches to the appropriate skill handler, encrypts response.
     *
     * @param sessionId — the session this request arrived on
     * @param wire — encrypted wire bytes from transport
     * @param transport — transport to send response back
     */
    handleRequest(sessionId: number, wire: Buffer, transport: SideloadTransport): Promise<void>;
    /**
     * Check for and claim any pending HTLC payments.
     */
    claimPayments(): Promise<string[]>;
    /** Get active session count */
    get sessionCount(): number;
    /** Get a session by ID */
    getSession(sessionId: number): ActiveSession | undefined;
    /** Clean up: zero keys, close sessions, stop scanning */
    destroy(): void;
    private assertNotDestroyed;
    private emitEvent;
}
export {};
//# sourceMappingURL=provider.d.ts.map