/**
 * HTTPS Sideload Transport
 *
 * Implements the SideloadTransport interface over HTTP(S).
 *
 * Provider side: starts an HTTP server that accepts POST /qp/sideload/:sessionId
 * Consumer side: sends POST requests to the provider's IP:port
 *
 * Wire bytes are sent as raw binary (application/octet-stream).
 * Bearer token from handshake is required in Authorization header.
 *
 * Session lifecycle:
 *   1. Handshake completes → both sides have SideloadConnectionInfo
 *   2. Consumer calls transport.send(remoteInfo, wire)
 *   3. Provider's server buffers incoming wire per sessionId
 *   4. Provider calls transport.receive(sessionId, timeout) → resolves from buffer
 *   5. Provider calls transport.send(remoteInfo, wire) → POST to consumer
 *   6. transport.close(sessionId) cleans up buffers
 */
import { type ServerOptions as TlsServerOptions } from 'https';
import type { SideloadConnectionInfo } from './types.js';
import type { SideloadTransport } from '../orchestrator/types.js';
export interface HttpsTransportOptions {
    /** Port to listen on (default: 0 = OS-assigned) */
    port?: number;
    /** Bind address (default: '0.0.0.0') */
    host?: string;
    /** Maximum wire message size in bytes (default: 10 MB) */
    maxMessageSize?: number;
    /** Request timeout in ms (default: 30000) */
    requestTimeoutMs?: number;
    /** Maximum queued messages per session (default: 1000) */
    maxQueueSize?: number;
    /** TLS options (key + cert). If provided, server uses HTTPS. */
    tls?: TlsServerOptions;
}
export declare class HttpsTransport implements SideloadTransport {
    private options;
    private server;
    private sessions;
    private listenPort;
    private listenHost;
    private maxMessageSize;
    private requestTimeoutMs;
    private destroyed;
    private maxQueueSize;
    private starting;
    constructor(options?: HttpsTransportOptions);
    /**
     * Start the HTTP server. Must be called before receive() works.
     * Returns the actual port (useful when port=0 for OS-assigned).
     */
    startServer(): Promise<number>;
    /** Get the port the server is listening on */
    get port(): number;
    /**
     * Register a session so the server accepts messages for it.
     * Must be called after handshake completes with the session's token.
     */
    registerSession(sessionId: number, token: Buffer): void;
    private handleRequest;
    private enqueue;
    /**
     * Send encrypted wire bytes to a remote endpoint via HTTP POST.
     */
    send(remoteInfo: SideloadConnectionInfo, wire: Buffer): Promise<void>;
    /**
     * Receive the next incoming wire buffer for a session.
     * Blocks until a message arrives or timeout expires.
     */
    receive(sessionId: number, timeoutMs: number): Promise<Buffer>;
    /**
     * Close the transport for a session. Cleans up buffers and rejects pending waiters.
     */
    close(sessionId: number): Promise<void>;
    /** Stop the server and clean up all sessions */
    destroy(): Promise<void>;
    /** True if the server is listening */
    get listening(): boolean;
    /** Number of active sessions */
    get sessionCount(): number;
    private assertNotDestroyed;
}
//# sourceMappingURL=transport.d.ts.map