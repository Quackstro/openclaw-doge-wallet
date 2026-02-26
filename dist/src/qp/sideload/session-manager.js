/**
 * Sideload Session Manager
 * Manages active P2P sessions and message exchange
 */
import { createHash } from 'crypto';
import { createMessage, encryptMessage, decryptMessage, envelopeToWire, wireToEnvelope, createSession, destroySession, } from './envelope.js';
/** Default session TTL: 24 hours */
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Session Manager — handles message exchange for a single session.
 */
export class SessionManager {
    session;
    pending = new Map();
    onMessage;
    ttlMs;
    constructor(params) {
        this.session = createSession(params);
        this.ttlMs = params.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    }
    /** Check if this session has expired */
    isExpired() {
        return Date.now() - this.session.createdAt > this.ttlMs;
    }
    /** Throw if session is expired */
    assertNotExpired() {
        if (this.isExpired()) {
            throw new Error(`Session ${this.session.sessionId} expired after ${this.ttlMs}ms`);
        }
    }
    /** Get session info */
    getSession() {
        return this.session;
    }
    /** Register a handler for incoming messages */
    onIncoming(handler) {
        this.onMessage = handler;
    }
    /**
     * Build an encrypted request message.
     * Returns wire bytes ready to send + the message ID for tracking.
     */
    buildRequest(body, meta) {
        this.assertNotExpired();
        const msg = createMessage({ type: 'request', body, meta });
        const { envelope, nextCounter } = encryptMessage(this.session, msg);
        this.session.sendCounter = nextCounter;
        return { wire: envelopeToWire(envelope), messageId: msg.id };
    }
    /**
     * Build an encrypted response message.
     */
    buildResponse(refId, body, meta) {
        const msg = createMessage({ type: 'response', body, ref: refId, meta });
        const { envelope, nextCounter } = encryptMessage(this.session, msg);
        this.session.sendCounter = nextCounter;
        return envelopeToWire(envelope);
    }
    /**
     * Build an encrypted error message.
     */
    buildError(refId, errorBody) {
        const msg = createMessage({ type: 'error', body: errorBody, ref: refId });
        const { envelope, nextCounter } = encryptMessage(this.session, msg);
        this.session.sendCounter = nextCounter;
        return envelopeToWire(envelope);
    }
    /** Maximum payload size for in-memory chunking (100 MB) */
    static MAX_CHUNK_PAYLOAD_SIZE = 100 * 1024 * 1024;
    /**
     * Build encrypted chunk messages for large data transfer.
     * For payloads > MAX_CHUNK_PAYLOAD_SIZE, use buildChunkIterator instead.
     */
    buildChunks(data, chunkSize = 1_048_576, // 1 MB
    meta) {
        if (data.length > SessionManager.MAX_CHUNK_PAYLOAD_SIZE) {
            throw new Error(`Payload too large for in-memory chunking: ${data.length} bytes ` +
                `(max ${SessionManager.MAX_CHUNK_PAYLOAD_SIZE}). Use buildChunkIterator instead.`);
        }
        const totalChunks = Math.ceil(data.length / chunkSize);
        const wires = [];
        for (let i = 0; i < totalChunks; i++) {
            const chunk = data.subarray(i * chunkSize, (i + 1) * chunkSize);
            const msg = createMessage({
                type: 'chunk',
                body: chunk,
                seq: i,
                meta: i === 0 ? {
                    totalChunks,
                    totalSize: data.length,
                    ...meta,
                } : undefined,
            });
            const { envelope, nextCounter } = encryptMessage(this.session, msg);
            this.session.sendCounter = nextCounter;
            wires.push(envelopeToWire(envelope));
        }
        // Send "done" message
        const sha256 = createHash('sha256').update(data).digest('hex');
        const doneMsg = createMessage({
            type: 'done',
            body: {},
            meta: { sha256, totalSize: data.length, totalChunks },
        });
        const { envelope, nextCounter } = encryptMessage(this.session, doneMsg);
        this.session.sendCounter = nextCounter;
        wires.push(envelopeToWire(envelope));
        return wires;
    }
    /**
     * Build encrypted chunks as an async generator (streaming, low memory).
     * Yields one wire buffer at a time — suitable for large payloads.
     */
    *buildChunkIterator(data, chunkSize = 1_048_576, meta) {
        const totalChunks = Math.ceil(data.length / chunkSize);
        for (let i = 0; i < totalChunks; i++) {
            const chunk = data.subarray(i * chunkSize, (i + 1) * chunkSize);
            const msg = createMessage({
                type: 'chunk',
                body: chunk,
                seq: i,
                meta: i === 0 ? {
                    totalChunks,
                    totalSize: data.length,
                    ...meta,
                } : undefined,
            });
            const { envelope, nextCounter } = encryptMessage(this.session, msg);
            this.session.sendCounter = nextCounter;
            yield envelopeToWire(envelope);
        }
        // Final "done" message
        const sha256 = createHash('sha256').update(data).digest('hex');
        const doneMsg = createMessage({
            type: 'done',
            body: {},
            meta: { sha256, totalSize: data.length, totalChunks },
        });
        const { envelope, nextCounter } = encryptMessage(this.session, doneMsg);
        this.session.sendCounter = nextCounter;
        yield envelopeToWire(envelope);
    }
    /**
     * Process incoming encrypted wire data.
     * Decrypts, updates counters, and dispatches.
     */
    processIncoming(wire) {
        this.assertNotExpired();
        const envelope = wireToEnvelope(wire);
        const { message, nextCounter } = decryptMessage(this.session, envelope);
        this.session.recvCounter = nextCounter;
        // If this is a response to a pending request, resolve it
        if (message.ref && this.pending.has(message.ref)) {
            const pending = this.pending.get(message.ref);
            clearTimeout(pending.timer);
            this.pending.delete(message.ref);
            if (message.t === 'error') {
                pending.reject(new Error(`Remote error: ${JSON.stringify(message.body)}`));
            }
            else {
                pending.resolve(message);
            }
        }
        // Dispatch to handler
        if (this.onMessage) {
            this.onMessage(message);
        }
        return message;
    }
    /**
     * Register a pending request for response tracking.
     * Returns a promise that resolves when the response arrives.
     */
    expectResponse(messageId, timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(messageId);
                reject(new Error(`Request ${messageId} timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.pending.set(messageId, { messageId, resolve, reject, timer });
        });
    }
    /**
     * Clean up pending requests and zero session key material.
     */
    destroy() {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Session destroyed'));
        }
        this.pending.clear();
        destroySession(this.session);
    }
    /** Get count of pending requests */
    get pendingCount() {
        return this.pending.size;
    }
}
/**
 * Reassemble chunks into a complete buffer.
 */
export function reassembleChunks(chunks, expectedHash) {
    // Sort by sequence number (non-mutating)
    const sorted = [...chunks].sort((a, b) => a.seq - b.seq);
    // Verify continuity
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].seq !== i) {
            throw new Error(`Missing chunk at sequence ${i}`);
        }
    }
    const assembled = Buffer.concat(sorted.map(c => c.body));
    // Verify hash if provided
    if (expectedHash) {
        const actualHash = createHash('sha256').update(assembled).digest('hex');
        if (actualHash !== expectedHash) {
            throw new Error(`Hash mismatch: expected ${expectedHash}, got ${actualHash}`);
        }
    }
    return assembled;
}
//# sourceMappingURL=session-manager.js.map