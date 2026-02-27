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

import { createServer as createHttpServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { createServer as createHttpsServer, type ServerOptions as TlsServerOptions } from 'https';
import type { SideloadConnectionInfo } from './types.js';
import type { SideloadTransport } from '../orchestrator/types.js';

// ---------------------------------------------------------------------------
// Per-session receive buffer
// ---------------------------------------------------------------------------

interface SessionBuffer {
  /** Queued incoming wire messages */
  queue: Buffer[];
  /** Pending receive waiters */
  waiters: Array<{
    resolve: (buf: Buffer) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  /** Bearer token for this session (hex) */
  tokenHex: string;
}

// ---------------------------------------------------------------------------
// HTTPS Transport
// ---------------------------------------------------------------------------

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

const DEFAULT_MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class HttpsTransport implements SideloadTransport {
  private server: Server | null = null;
  private sessions: Map<number, SessionBuffer> = new Map();
  private listenPort: number = 0;
  private listenHost: string;
  private maxMessageSize: number;
  private requestTimeoutMs: number;
  private destroyed = false;
  private maxQueueSize: number;
  private starting: Promise<number> | null = null;

  constructor(private options: HttpsTransportOptions = {}) {
    this.listenHost = options.host ?? '0.0.0.0';
    this.maxMessageSize = options.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxQueueSize = options.maxQueueSize ?? 1000;
  }

  // =========================================================================
  // Server (provider side)
  // =========================================================================

  /**
   * Start the HTTP server. Must be called before receive() works.
   * Returns the actual port (useful when port=0 for OS-assigned).
   */
  async startServer(): Promise<number> {
    this.assertNotDestroyed();
    if (this.server) return this.listenPort;
    if (this.starting) return this.starting;

    this.starting = new Promise<number>((resolve, reject) => {
      const handler = (req: IncomingMessage, res: ServerResponse) => this.handleRequest(req, res);
      const srv = this.options.tls
        ? createHttpsServer(this.options.tls, handler)
        : createHttpServer(handler);

      srv.on('error', reject);
      srv.listen(this.options.port ?? 0, this.listenHost, () => {
        const addr = srv.address();
        if (typeof addr === 'object' && addr) {
          this.listenPort = addr.port;
        }
        this.server = srv;
        this.starting = null;
        resolve(this.listenPort);
      });
    });
    return this.starting;
  }

  /** Get the port the server is listening on */
  get port(): number {
    return this.listenPort;
  }

  /**
   * Register a session so the server accepts messages for it.
   * Must be called after handshake completes with the session's token.
   */
  registerSession(sessionId: number, token: Buffer): void {
    this.assertNotDestroyed();
    if (token.length !== 8) {
      throw new Error(`Token must be exactly 8 bytes, got ${token.length}`);
    }
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already registered. Close it first to re-register.`);
    }
    this.sessions.set(sessionId, {
      queue: [],
      waiters: [],
      tokenHex: token.toString('hex'),
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only accept POST /qp/sideload/:sessionId
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      res.end('Method Not Allowed');
      return;
    }

    const match = req.url?.match(/^\/qp\/sideload\/(\d+)$/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const sessionId = parseInt(match[1], 10);
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Unknown session');
      return;
    }

    // Verify bearer token
    const authHeader = req.headers['authorization'];
    const expectedAuth = `Bearer ${session.tokenHex}`;
    if (authHeader !== expectedAuth) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }

    // Read body
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > this.maxMessageSize) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload Too Large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.writableEnded) return; // Already responded (413)

      const wire = Buffer.concat(chunks);
      if (wire.length === 0) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Empty body');
        return;
      }

      const accepted = this.enqueue(sessionId, wire);
      if (accepted) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('Queue full or session closed');
      }
    });

    req.on('error', () => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Error');
      }
    });
  }

  private enqueue(sessionId: number, wire: Buffer): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // If there's a waiter, deliver directly
    if (session.waiters.length > 0) {
      const waiter = session.waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(wire);
      return true;
    }

    // Bound the queue
    if (session.queue.length >= this.maxQueueSize) {
      return false;
    }

    session.queue.push(wire);
    return true;
  }

  // =========================================================================
  // SideloadTransport interface
  // =========================================================================

  /**
   * Send encrypted wire bytes to a remote endpoint via HTTP POST.
   */
  async send(remoteInfo: SideloadConnectionInfo, wire: Buffer): Promise<void> {
    this.assertNotDestroyed();

    const ip = `${remoteInfo.ipv4[0]}.${remoteInfo.ipv4[1]}.${remoteInfo.ipv4[2]}.${remoteInfo.ipv4[3]}`;
    const proto = this.options.tls ? 'https' : 'http';
    const url = `${proto}://${ip}:${remoteInfo.port}/qp/sideload/${remoteInfo.sessionId}`;
    const tokenHex = remoteInfo.token.toString('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${tokenHex}`,
        },
        body: wire,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Transport send failed: ${response.status} ${text}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Receive the next incoming wire buffer for a session.
   * Blocks until a message arrives or timeout expires.
   */
  async receive(sessionId: number, timeoutMs: number): Promise<Buffer> {
    this.assertNotDestroyed();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`No registered session: ${sessionId}`);
    }

    // Check queue first
    if (session.queue.length > 0) {
      return session.queue.shift()!;
    }

    // Wait for next message
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const idx = session.waiters.findIndex(w => w.timer === timer);
        if (idx >= 0) session.waiters.splice(idx, 1);
        reject(new Error(`Receive timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      session.waiters.push({ resolve, reject, timer });
    });
  }

  /**
   * Close the transport for a session. Cleans up buffers and rejects pending waiters.
   */
  async close(sessionId: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Reject all pending waiters
    for (const waiter of session.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Session closed'));
    }

    this.sessions.delete(sessionId);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /** Stop the server and clean up all sessions */
  async destroy(): Promise<void> {
    this.destroyed = true;

    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      await this.close(sessionId);
    }

    // Shut down server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });
      });
    }
  }

  /** True if the server is listening */
  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  /** Number of active sessions */
  get sessionCount(): number {
    return this.sessions.size;
  }

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('Transport has been destroyed');
    }
  }
}
