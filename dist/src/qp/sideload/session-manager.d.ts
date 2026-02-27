/**
 * Sideload Session Manager
 * Manages active P2P sessions and message exchange
 */
import type { SideloadSession, SideloadMessage, SideloadMeta, SideloadConnectionInfo } from './types.js';
/**
 * Session Manager — handles message exchange for a single session.
 */
export declare class SessionManager {
    private session;
    private pending;
    private onMessage?;
    private ttlMs;
    constructor(params: {
        sessionId: number;
        sessionKey: Buffer;
        role: 'initiator' | 'responder';
        remoteInfo: SideloadConnectionInfo;
        /** Session TTL in ms (default 24 hours) */
        ttlMs?: number;
    });
    /** Check if this session has expired */
    isExpired(): boolean;
    /** Throw if session is expired */
    private assertNotExpired;
    /** Get session info */
    getSession(): Readonly<SideloadSession>;
    /** Register a handler for incoming messages */
    onIncoming(handler: (msg: SideloadMessage) => void): void;
    /**
     * Build an encrypted request message.
     * Returns wire bytes ready to send + the message ID for tracking.
     */
    buildRequest(body: Buffer | Record<string, unknown>, meta?: SideloadMeta): {
        wire: Buffer;
        messageId: string;
    };
    /**
     * Build an encrypted response message.
     */
    buildResponse(refId: string, body: Buffer | Record<string, unknown>, meta?: SideloadMeta): Buffer;
    /**
     * Build an encrypted error message.
     */
    buildError(refId: string, errorBody: Record<string, unknown>): Buffer;
    /** Maximum payload size for in-memory chunking (100 MB) */
    static readonly MAX_CHUNK_PAYLOAD_SIZE: number;
    /**
     * Build encrypted chunk messages for large data transfer.
     * For payloads > MAX_CHUNK_PAYLOAD_SIZE, use buildChunkIterator instead.
     */
    buildChunks(data: Buffer, chunkSize?: number, // 1 MB
    meta?: Partial<SideloadMeta>): Buffer[];
    /**
     * Build encrypted chunks as an async generator (streaming, low memory).
     * Yields one wire buffer at a time — suitable for large payloads.
     */
    buildChunkIterator(data: Buffer, chunkSize?: number, meta?: Partial<SideloadMeta>): Generator<Buffer, void, undefined>;
    /**
     * Process incoming encrypted wire data.
     * Decrypts, updates counters, and dispatches.
     */
    processIncoming(wire: Buffer): SideloadMessage;
    /**
     * Register a pending request for response tracking.
     * Returns a promise that resolves when the response arrives.
     */
    expectResponse(messageId: string, timeoutMs?: number): Promise<SideloadMessage>;
    /**
     * Clean up pending requests and zero session key material.
     */
    destroy(): void;
    /** Get count of pending requests */
    get pendingCount(): number;
}
/**
 * Reassemble chunks into a complete buffer.
 */
export declare function reassembleChunks(chunks: Array<{
    seq: number;
    body: Buffer;
}>, expectedHash?: string): Buffer;
//# sourceMappingURL=session-manager.d.ts.map