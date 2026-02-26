/**
 * QP Provider — Service provider handler
 *
 * Advertises skills on-chain, handles incoming handshakes,
 * processes sideload requests, and claims payments.
 */
import { randomBytes } from 'crypto';
import { EventEmitter } from 'node:events';
import { ecdhSharedSecret, deriveHandshakeKey, deriveSessionKey, aesGcmEncrypt, aesGcmDecrypt, deriveIv, generateEphemeralKeyPair, } from '../crypto.js';
import { encodeMessage, } from '../messages.js';
import { QPMessageType, QP_MAGIC, QP_VERSION, } from '../types.js';
import { SideloadProtocol } from '../sideload/types.js';
import { scanAddress } from '../chain/scanner.js';
import { buildAdvertiseTx, signTx, serializeTx, broadcastTx, } from '../chain/tx-builder.js';
import { HTLCProviderManager, InMemoryHTLCStorage, } from '../htlc/manager.js';
import { SessionManager } from '../sideload/session-manager.js';
import { CallState } from './types.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script } = bitcore;
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_ADVERTISE_TTL_BLOCKS = 10_080; // ~7 days
const DEFAULT_SCAN_INTERVAL_MS = 60_000;
const DEFAULT_FEE_KOINU = 1_000_000;
const DUST_AMOUNT_KOINU = 100_000_000;
// ---------------------------------------------------------------------------
// QPProvider
// ---------------------------------------------------------------------------
export class QPProvider extends EventEmitter {
    config;
    htlcStorage = new InMemoryHTLCStorage();
    htlcManager;
    sessions = new Map();
    skillHandlers = new Map();
    scanTimer;
    running = false;
    destroyed = false;
    constructor(config) {
        super();
        this.config = {
            advertiseTtlBlocks: DEFAULT_ADVERTISE_TTL_BLOCKS,
            scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
            ...config,
        };
        this.htlcManager = new HTLCProviderManager(this.htlcStorage, config.pubkey, config.privkey, config.address);
        // Index skill handlers
        for (const skill of config.skills) {
            this.skillHandlers.set(skill.skillCode, skill);
        }
    }
    // =========================================================================
    // Advertise
    // =========================================================================
    /**
     * Advertise all registered skills on-chain.
     * Broadcasts one SERVICE_ADVERTISE tx per skill to the appropriate registry.
     * Returns the list of transaction IDs.
     */
    async advertise() {
        this.assertNotDestroyed();
        const txIds = [];
        for (const skill of this.config.skills) {
            const params = {
                skillCode: skill.skillCode,
                priceKoinu: skill.priceKoinu,
                priceUnit: skill.priceUnit,
                flags: skill.flags,
                ttlBlocks: this.config.advertiseTtlBlocks,
                pubkey: this.config.pubkey,
                description: skill.description,
                category: skillToCategory(skill.skillCode),
            };
            const utxos = await this.config.getUtxos();
            const tx = buildAdvertiseTx({
                advertise: params,
                utxos,
                changeAddress: this.config.changeAddress,
            });
            const signed = signTx(tx, this.config.privkey);
            const txHex = serializeTx(signed);
            const { txid } = await broadcastTx(this.config.provider, txHex);
            txIds.push(txid);
        }
        return txIds;
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    /**
     * Start listening for incoming handshakes.
     * Periodically scans the chain for HANDSHAKE_INIT messages directed at us.
     */
    start() {
        this.assertNotDestroyed();
        if (this.running)
            return;
        this.running = true;
        let scanning = false;
        this.scanTimer = setInterval(async () => {
            if (scanning)
                return; // Prevent overlap
            scanning = true;
            try {
                await this.scanForHandshakes();
            }
            catch (err) {
                this.emitEvent('scan-error', 'error', CallState.FAILED, {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            finally {
                scanning = false;
            }
        }, this.config.scanIntervalMs);
    }
    /** Stop listening */
    stop() {
        this.running = false;
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = undefined;
        }
    }
    // =========================================================================
    // Handshake handling
    // =========================================================================
    /**
     * Scan for incoming HANDSHAKE_INIT messages and respond.
     */
    async scanForHandshakes() {
        this.assertNotDestroyed();
        const messages = await scanAddress(this.config.provider, this.config.address, 20, { messageTypes: [QPMessageType.HANDSHAKE_INIT] });
        for (const msg of messages) {
            try {
                await this.handleHandshakeInit(msg);
            }
            catch (err) {
                this.emitEvent('handshake-error', 'error', CallState.FAILED, { phase: 'handshake', error: err });
            }
        }
    }
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
    async handleHandshakeInit(msg) {
        this.assertNotDestroyed();
        const payload = msg.message.payload;
        // Step 1: Decrypt consumer's P2P details
        const initSecret = ecdhSharedSecret(this.config.privkey, payload.ephemeralPubkey);
        const encKey = deriveHandshakeKey(initSecret, payload.nonce);
        const iv = deriveIv(payload.nonce, payload.timestamp);
        const ct = payload.encryptedData.subarray(0, payload.encryptedData.length - 16);
        const tag = payload.encryptedData.subarray(payload.encryptedData.length - 16);
        const pt = aesGcmDecrypt(encKey, iv, ct, tag);
        // Decode compact binary (19 bytes)
        if (pt.length < 19)
            return;
        const sessionId = pt.readUInt32BE(0);
        // Skip if we already have this session
        if (this.sessions.has(sessionId))
            return;
        const consumerInfo = {
            sessionId,
            port: pt.readUInt16BE(4),
            ipv4: Buffer.from(pt.subarray(6, 10)),
            protocol: pt.readUInt8(10),
            token: Buffer.from(pt.subarray(11, 19)),
        };
        // Step 2: Generate our ephemeral key pair
        const ephemeral = generateEphemeralKeyPair();
        try {
            // Step 3: Compute session key
            const sessionSecret = ecdhSharedSecret(ephemeral.privateKey, payload.ephemeralPubkey);
            const sessionKey = deriveSessionKey(sessionSecret, sessionId);
            // Step 4: Encrypt our P2P details
            const ackNonce = randomBytes(4);
            const ackEncKey = deriveHandshakeKey(ecdhSharedSecret(ephemeral.privateKey, payload.ephemeralPubkey), ackNonce);
            const ackIv = deriveIv(ackNonce, sessionId);
            const ourInfo = {
                sessionId,
                port: this.config.sideloadPort ?? 8443,
                ipv4: this.config.sideloadIpv4 ?? Buffer.from([0, 0, 0, 0]),
                protocol: SideloadProtocol.HTTPS,
                token: randomBytes(8),
            };
            // Serialize P2P details as compact binary (19 bytes)
            const ackPlaintext = Buffer.alloc(19);
            ackPlaintext.writeUInt32BE(sessionId, 0);
            ackPlaintext.writeUInt16BE(ourInfo.port, 4);
            ourInfo.ipv4.copy(ackPlaintext, 6, 0, 4);
            ackPlaintext.writeUInt8(ourInfo.protocol, 10);
            ourInfo.token.copy(ackPlaintext, 11, 0, 8);
            const { ciphertext, tag: ackTag } = aesGcmEncrypt(ackEncKey, ackIv, ackPlaintext);
            const encryptedData = Buffer.concat([ciphertext, ackTag]);
            // Step 5: Build and broadcast HANDSHAKE_ACK
            const ackPayload = {
                ephemeralPubkey: ephemeral.publicKey,
                sessionId,
                nonce: ackNonce,
                encryptedData,
            };
            const opReturn = encodeMessage({
                magic: QP_MAGIC,
                version: QP_VERSION,
                type: QPMessageType.HANDSHAKE_ACK,
                payload: ackPayload,
            });
            const utxos = await this.config.getUtxos();
            const tx = new Transaction();
            for (const utxo of utxos) {
                tx.from({
                    txId: utxo.txid,
                    outputIndex: utxo.vout,
                    satoshis: utxo.amount,
                    script: utxo.scriptPubKey,
                });
            }
            tx.to(msg.senderAddress, DUST_AMOUNT_KOINU);
            tx.addOutput(new Transaction.Output({
                satoshis: 0,
                script: Script.buildDataOut(opReturn),
            }));
            tx.change(this.config.changeAddress);
            tx.fee(DEFAULT_FEE_KOINU);
            const signed = signTx(tx, this.config.privkey);
            const txHex = serializeTx(signed);
            await broadcastTx(this.config.provider, txHex);
            // Step 6: Create session
            const sessionManager = new SessionManager({
                sessionId,
                sessionKey,
                role: 'responder',
                remoteInfo: consumerInfo,
                ttlMs: this.config.sessionTtlMs,
            });
            this.sessions.set(sessionId, {
                sessionId,
                sessionKey,
                remoteInfo: consumerInfo,
                consumerAddress: msg.senderAddress,
                sessionManager,
                createdAt: Date.now(),
            });
            this.emitEvent(`session-${sessionId}`, 'handshake_complete', CallState.CONNECTING, {
                sessionId,
                consumerAddress: msg.senderAddress,
            });
        }
        finally {
            ephemeral.privateKey.fill(0);
        }
    }
    // =========================================================================
    // Request handling
    // =========================================================================
    /**
     * Process an incoming encrypted sideload request.
     * Decrypts, dispatches to the appropriate skill handler, encrypts response.
     *
     * @param sessionId — the session this request arrived on
     * @param wire — encrypted wire bytes from transport
     * @param transport — transport to send response back
     */
    async handleRequest(sessionId, wire, transport) {
        this.assertNotDestroyed();
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Unknown session: ${sessionId}`);
        }
        // Decrypt
        const message = session.sessionManager.processIncoming(wire);
        if (message.t !== 'request') {
            return; // Only handle requests
        }
        // Extract skill code from metadata or body
        const body = message.body;
        const skillCode = body.skillCode ?? session.skillCode;
        const handler = skillCode !== undefined ? this.skillHandlers.get(skillCode) : undefined;
        if (!handler) {
            // Send error
            const errorWire = session.sessionManager.buildError(message.id, { error: 'unknown_skill', message: `Skill 0x${(skillCode ?? 0).toString(16)} not supported` });
            await transport.send(session.remoteInfo, errorWire);
            return;
        }
        try {
            // Execute handler
            const result = await handler.handler(body);
            // Build encrypted response
            const responseWire = session.sessionManager.buildResponse(message.id, result);
            // Send back via transport
            await transport.send(session.remoteInfo, responseWire);
            this.emitEvent(`session-${sessionId}`, 'delivery_received', CallState.COMPLETE, {
                skillCode,
                messageId: message.id,
            });
        }
        catch (err) {
            const errorWire = session.sessionManager.buildError(message.id, { error: 'handler_error', message: err instanceof Error ? err.message : String(err) });
            await transport.send(session.remoteInfo, errorWire);
        }
    }
    // =========================================================================
    // Payment claiming
    // =========================================================================
    /**
     * Check for and claim any pending HTLC payments.
     */
    async claimPayments() {
        this.assertNotDestroyed();
        const pending = await this.htlcManager.getPendingHTLCs();
        const claimed = [];
        for (const htlc of pending) {
            try {
                const result = await this.htlcManager.claim(htlc.id);
                const { txid } = await broadcastTx(this.config.provider, result.claimTx);
                claimed.push(txid);
            }
            catch (err) {
                this.emitEvent('claim-error', 'error', CallState.FAILED, { phase: 'claim', htlcId: htlc.id, error: err });
            }
        }
        return claimed;
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /** Get active session count */
    get sessionCount() {
        return this.sessions.size;
    }
    /** Get a session by ID */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /** Clean up: zero keys, close sessions, stop scanning */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.stop();
        // Zero private key
        this.config.privkey.fill(0);
        // Zero session keys
        for (const session of this.sessions.values()) {
            session.sessionManager.destroy();
            session.sessionKey.fill(0);
        }
        this.sessions.clear();
        this.removeAllListeners();
    }
    assertNotDestroyed() {
        if (this.destroyed) {
            throw new Error('QPProvider has been destroyed');
        }
    }
    emitEvent(callId, type, state, detail) {
        const event = {
            type,
            callId,
            state,
            detail,
            timestamp: Date.now(),
        };
        // Emit wildcard first (always safe)
        this.emit('*', event);
        // Guard 'error' to avoid Node.js uncaught error throw
        if (type === 'error' && this.listenerCount('error') === 0) {
            // No 'error' listener — skip
        }
        else {
            this.emit(type, event);
        }
    }
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Map skill code range to registry category.
 * See spec §6.1 and README.
 */
function skillToCategory(skillCode) {
    const range = (skillCode >> 8) & 0xff;
    switch (range) {
        case 0x00: return 'general';
        case 0x01: return 'general'; // text & language → general
        case 0x02: return 'compute'; // code & development → compute
        case 0x03: return 'data'; // data & analytics → data
        case 0x04: return 'content'; // media → content
        case 0x05: return 'general'; // research → general
        case 0x06: return 'compute'; // infrastructure → compute
        case 0x07: return 'general'; // finance → general
        case 0x08: return 'compute'; // security → compute
        default: return 'general';
    }
}
//# sourceMappingURL=provider.js.map