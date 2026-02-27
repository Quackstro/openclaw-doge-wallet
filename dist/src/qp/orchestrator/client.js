/**
 * QP Client — Consumer-side Orchestrator
 *
 * Drives the full Quackstro Protocol lifecycle:
 *   discover → handshake → sideload → deliver → pay → rate
 */
import { randomBytes, randomUUID } from 'crypto';
import { EventEmitter } from 'node:events';
import { ecdhSharedSecret, deriveHandshakeKey, deriveSessionKey, aesGcmEncrypt, aesGcmDecrypt, deriveIv, generateEphemeralKeyPair, sha256, } from '../crypto.js';
import { encodeMessage, } from '../messages.js';
import { QPMessageType, QP_MAGIC, QP_VERSION, } from '../types.js';
import { SideloadProtocol } from '../sideload/types.js';
import { RegistryWatcher } from '../chain/registry-watcher.js';
import { scanAddress } from '../chain/scanner.js';
import { buildRatingTx, signTx, serializeTx, broadcastTx, } from '../chain/tx-builder.js';
import { HTLCConsumerManager, InMemoryHTLCStorage, } from '../htlc/manager.js';
import { SessionManager } from '../sideload/session-manager.js';
import { CallState } from './types.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script } = bitcore;
// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_HANDSHAKE_TIMEOUT_BLOCKS = 30;
const DEFAULT_HTLC_TIMEOUT_BLOCKS = 144;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DELIVERY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_RATING = 5;
const DUST_AMOUNT_KOINU = 100_000_000; // 1 DOGE
const DEFAULT_FEE_KOINU = 1_000_000;
// ---------------------------------------------------------------------------
// QPClient
// ---------------------------------------------------------------------------
export class QPClient extends EventEmitter {
    config;
    watcher;
    htlcStorage = new InMemoryHTLCStorage();
    htlcManager;
    activeCalls = new Map();
    destroyed = false;
    constructor(config) {
        super();
        this.config = {
            handshakeTimeoutBlocks: DEFAULT_HANDSHAKE_TIMEOUT_BLOCKS,
            htlcTimeoutBlocks: DEFAULT_HTLC_TIMEOUT_BLOCKS,
            sessionTtlMs: DEFAULT_SESSION_TTL_MS,
            autoRate: true,
            defaultRating: DEFAULT_RATING,
            ...config,
        };
        this.watcher = new RegistryWatcher(config.provider);
        this.htlcManager = new HTLCConsumerManager(this.htlcStorage, config.pubkey, config.privkey, config.address);
    }
    // =========================================================================
    // High-level API
    // =========================================================================
    /**
     * Full lifecycle: discover → handshake → sideload → deliver → pay → rate.
     *
     * @param request — what skill we need and how much we'll pay
     * @param transport — how to send/receive sideload wire bytes
     * @returns ServiceResult with response payload and payment details
     */
    async callService(request, transport) {
        this.assertNotDestroyed();
        const callId = randomUUID();
        const startedAt = Date.now();
        const call = {
            id: callId,
            state: CallState.DISCOVERING,
            request,
            startedAt,
        };
        this.activeCalls.set(callId, call);
        try {
            // Step 1: Discover
            this.emitEvent(callId, 'state_change', CallState.DISCOVERING);
            const providers = await this.discoverProviders(request.skillCode, request.maxPriceKoinu);
            if (providers.length === 0) {
                throw new Error(`No providers found for skill 0x${request.skillCode.toString(16)}`);
            }
            // Pick best provider (cheapest that meets criteria)
            const provider = providers[0];
            call.providerAddress = provider.providerAddress;
            call.providerPubkey = provider.providerPubkey;
            this.emitEvent(callId, 'provider_found', CallState.DISCOVERING, {
                address: provider.providerAddress,
                priceKoinu: provider.priceKoinu,
            });
            // Step 2: Handshake
            this.emitEvent(callId, 'state_change', CallState.HANDSHAKING);
            const handshake = await this.initiateHandshake(provider);
            call.sessionId = handshake.sessionId;
            call.sessionKey = handshake.sessionKey;
            call.remoteInfo = handshake.remoteInfo;
            this.emitEvent(callId, 'handshake_complete', CallState.HANDSHAKING, {
                sessionId: handshake.sessionId,
            });
            // Step 3: Send request via sideload
            this.emitEvent(callId, 'state_change', CallState.REQUESTING);
            const { messageId, sessionManager } = await this.sendRequest(handshake.sessionId, handshake.sessionKey, handshake.remoteInfo, request.payload, transport);
            // Step 4: Await delivery
            this.emitEvent(callId, 'state_change', CallState.AWAITING_DELIVERY);
            const delivery = await this.awaitDelivery(sessionManager, messageId, transport, DEFAULT_DELIVERY_TIMEOUT_MS);
            this.emitEvent(callId, 'delivery_received', CallState.AWAITING_DELIVERY, {
                responseType: typeof delivery.body,
            });
            // Step 5: Pay
            this.emitEvent(callId, 'state_change', CallState.PAYING);
            const method = request.preferredPayment ?? 'htlc';
            // Compute delivery hash for audit trail
            const deliveryBuf = Buffer.isBuffer(delivery.body)
                ? delivery.body
                : Buffer.from(JSON.stringify(delivery.body));
            const deliveryHash = sha256(deliveryBuf);
            const payment = await this.pay({
                providerAddress: provider.providerAddress,
                providerPubkey: provider.providerPubkey,
                amountKoinu: provider.priceKoinu,
                method,
                sessionId: handshake.sessionId,
                skillCode: request.skillCode,
                deliveryHash,
            });
            call.paymentTxId = payment.txId;
            call.htlcId = payment.htlcId;
            this.emitEvent(callId, 'payment_sent', CallState.PAYING, {
                txId: payment.txId,
                method,
            });
            // Step 6: Rate (optional)
            let ratingTxId;
            if (this.config.autoRate) {
                this.emitEvent(callId, 'state_change', CallState.RATING);
                const ratingResult = await this.rateProvider({
                    providerAddress: provider.providerAddress,
                    providerPubkey: provider.providerPubkey,
                    sessionId: handshake.sessionId,
                    skillCode: request.skillCode,
                    paymentTxId: payment.txId,
                    rating: this.config.defaultRating,
                });
                ratingTxId = ratingResult.txId;
                this.emitEvent(callId, 'rated', CallState.RATING, { txId: ratingResult.txId });
            }
            // Done
            call.state = CallState.COMPLETE;
            this.emitEvent(callId, 'state_change', CallState.COMPLETE);
            // Clean up sideload session
            sessionManager.destroy();
            const result = {
                success: true,
                response: delivery.body,
                providerAddress: provider.providerAddress,
                paymentTxId: payment.txId,
                ratingTxId,
                htlcId: payment.htlcId,
                totalCostKoinu: provider.priceKoinu + DEFAULT_FEE_KOINU,
                durationMs: Date.now() - startedAt,
            };
            return result;
        }
        catch (err) {
            call.state = CallState.FAILED;
            call.error = err instanceof Error ? err : new Error(String(err));
            this.emitEvent(callId, 'error', CallState.FAILED, { error: call.error.message });
            throw err;
        }
        finally {
            this.activeCalls.delete(callId);
        }
    }
    // =========================================================================
    // Step 1: Discovery
    // =========================================================================
    /**
     * Find providers for a skill code.
     * Scans the on-chain registry, filters by price and flags, sorts by price ascending.
     */
    async discoverProviders(skillCode, maxPriceKoinu) {
        this.assertNotDestroyed();
        // Scan for new listings
        await this.watcher.scan();
        // Get current block height for expiry filtering
        const status = await this.watcher.getChainStatus();
        const directory = this.watcher.getDirectory();
        let listings = directory.findBySkill(skillCode, status.blockHeight);
        // Filter by max price
        if (maxPriceKoinu !== undefined) {
            listings = listings.filter(l => l.priceKoinu <= maxPriceKoinu);
        }
        // Filter out self
        listings = listings.filter(l => l.providerAddress !== this.config.address);
        // Sort by price ascending (cheapest first)
        listings.sort((a, b) => a.priceKoinu - b.priceKoinu);
        return listings;
    }
    // =========================================================================
    // Step 2: Handshake
    // =========================================================================
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
    async initiateHandshake(provider) {
        this.assertNotDestroyed();
        // Step 1: Generate ephemeral key pair
        const ephemeral = generateEphemeralKeyPair();
        try {
            // Step 2: Compute shared secret for INIT encryption
            const initSecret = ecdhSharedSecret(ephemeral.privateKey, provider.providerPubkey);
            // Step 3: Encrypt our P2P connection details
            const sessionId = randomBytes(4).readUInt32BE();
            const nonce = randomBytes(4);
            const timestamp = Math.floor(Date.now() / 1000);
            const encKey = deriveHandshakeKey(initSecret, nonce);
            const iv = deriveIv(nonce, timestamp);
            // Our P2P details (consumer side)
            const ourInfo = {
                sessionId,
                port: 8443,
                ipv4: Buffer.from([0, 0, 0, 0]), // placeholder — real IP set by transport
                protocol: SideloadProtocol.HTTPS,
                token: randomBytes(8),
            };
            // Serialize P2P details as compact binary (19 bytes)
            // Layout: session_id(4) + port(2) + ipv4(4) + protocol(1) + token(8)
            const plaintext = Buffer.alloc(19);
            plaintext.writeUInt32BE(sessionId, 0);
            plaintext.writeUInt16BE(ourInfo.port, 4);
            ourInfo.ipv4.copy(plaintext, 6, 0, 4);
            plaintext.writeUInt8(ourInfo.protocol, 10);
            ourInfo.token.copy(plaintext, 11, 0, 8);
            const { ciphertext, tag } = aesGcmEncrypt(encKey, iv, plaintext);
            const encryptedData = Buffer.concat([ciphertext, tag]);
            // Step 4: Build HANDSHAKE_INIT payload
            const initPayload = {
                ephemeralPubkey: ephemeral.publicKey,
                timestamp,
                nonce,
                encryptedData,
            };
            const opReturn = encodeMessage({
                magic: QP_MAGIC,
                version: QP_VERSION,
                type: QPMessageType.HANDSHAKE_INIT,
                payload: initPayload,
            });
            // Build and broadcast tx
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
            tx.to(provider.providerAddress, DUST_AMOUNT_KOINU);
            tx.addOutput(new Transaction.Output({
                satoshis: 0,
                script: Script.buildDataOut(opReturn),
            }));
            tx.change(this.config.changeAddress);
            tx.fee(DEFAULT_FEE_KOINU);
            const signed = signTx(tx, this.config.privkey);
            const txHex = serializeTx(signed);
            const { txid: initTxId } = await broadcastTx(this.config.provider, txHex);
            // Step 5: Wait for HANDSHAKE_ACK
            // Poll the chain for ACK sent to our address
            const ack = await this.waitForHandshakeAck(sessionId, ephemeral.privateKey, provider.providerPubkey);
            // Step 6: Derive session key from double ECDH
            // Session secret = our_ephemeral × their_ephemeral_pubkey
            const sessionSecret = ecdhSharedSecret(ephemeral.privateKey, ack.ephemeralPubkey);
            const sessionKey = deriveSessionKey(sessionSecret, sessionId);
            // Zero ephemeral private key
            ephemeral.privateKey.fill(0);
            return {
                sessionId,
                sessionKey,
                remoteInfo: ack.remoteInfo,
            };
        }
        catch (err) {
            // Ensure ephemeral key is zeroed even on failure
            ephemeral.privateKey.fill(0);
            throw err;
        }
    }
    /**
     * Poll chain for HANDSHAKE_ACK directed at us.
     */
    async waitForHandshakeAck(sessionId, ourEphemeralPrivkey, providerLongTermPubkey) {
        const maxAttempts = this.config.handshakeTimeoutBlocks * 2; // poll ~twice per block
        const pollIntervalMs = 30_000; // 30s
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const messages = await scanAddress(this.config.provider, this.config.address, 10, { messageTypes: [QPMessageType.HANDSHAKE_ACK] });
            for (const msg of messages) {
                try {
                    const payload = msg.message.payload;
                    // Derive session secret to decrypt ACK
                    // ACK uses ephemeral-ephemeral ECDH + sessionId as timestamp for IV
                    const ackSecret = ecdhSharedSecret(ourEphemeralPrivkey, payload.ephemeralPubkey);
                    const encKey = deriveHandshakeKey(ackSecret, payload.nonce);
                    const iv = deriveIv(payload.nonce, payload.sessionId);
                    // Split encrypted data into ciphertext + tag
                    const ct = payload.encryptedData.subarray(0, payload.encryptedData.length - 16);
                    const tag = payload.encryptedData.subarray(payload.encryptedData.length - 16);
                    const pt = aesGcmDecrypt(encKey, iv, ct, tag);
                    // Decode compact binary (19 bytes)
                    if (pt.length < 19)
                        continue;
                    const ackSessionId = pt.readUInt32BE(0);
                    if (ackSessionId !== sessionId)
                        continue;
                    return {
                        ephemeralPubkey: payload.ephemeralPubkey,
                        remoteInfo: {
                            sessionId: ackSessionId,
                            port: pt.readUInt16BE(4),
                            ipv4: Buffer.from(pt.subarray(6, 10)),
                            protocol: pt.readUInt8(10),
                            token: Buffer.from(pt.subarray(11, 19)),
                        },
                    };
                }
                catch {
                    // Decryption failed — not our ACK, skip
                    continue;
                }
            }
            // Wait before next poll
            if (attempt < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }
        }
        throw new Error(`Handshake timeout: no ACK received within ${this.config.handshakeTimeoutBlocks} blocks`);
    }
    // =========================================================================
    // Step 3: Send request
    // =========================================================================
    /**
     * Open sideload session and send work request.
     */
    async sendRequest(sessionId, sessionKey, remoteInfo, payload, transport) {
        this.assertNotDestroyed();
        const sessionManager = new SessionManager({
            sessionId,
            sessionKey,
            role: 'initiator',
            remoteInfo,
            ttlMs: this.config.sessionTtlMs,
        });
        const { wire, messageId } = sessionManager.buildRequest(Buffer.isBuffer(payload) ? payload : (typeof payload === "string" ? Buffer.from(payload) : payload));
        // Send via transport
        await transport.send(remoteInfo, wire);
        return { messageId, sessionManager };
    }
    // =========================================================================
    // Step 4: Await delivery
    // =========================================================================
    /**
     * Wait for provider's response via sideload.
     */
    async awaitDelivery(sessionManager, messageId, transport, timeoutMs = DEFAULT_DELIVERY_TIMEOUT_MS) {
        this.assertNotDestroyed();
        const session = sessionManager.getSession();
        const responsePromise = sessionManager.expectResponse(messageId, timeoutMs);
        // Receive wire bytes from transport and feed to session manager
        let cancelled = false;
        const receiveLoop = async () => {
            const deadline = Date.now() + timeoutMs;
            while (!cancelled && Date.now() < deadline) {
                try {
                    const remaining = deadline - Date.now();
                    const wire = await transport.receive(session.sessionId, Math.min(remaining, 10_000));
                    if (!cancelled)
                        sessionManager.processIncoming(wire);
                }
                catch {
                    // Timeout on single receive — continue loop
                }
            }
        };
        // Race: response promise vs receive loop feeding it
        const loopPromise = receiveLoop();
        try {
            const response = await responsePromise;
            return response;
        }
        finally {
            cancelled = true;
            await loopPromise.catch(() => { });
        }
    }
    // =========================================================================
    // Step 5: Pay
    // =========================================================================
    /**
     * Pay provider via HTLC.
     *
     * For MVP: direct HTLC only. Channel payments are a future enhancement.
     */
    async pay(params) {
        this.assertNotDestroyed();
        if (params.method === 'channel') {
            throw new Error('Channel payments not yet implemented in orchestrator');
        }
        // For HTLC: we need the provider to send us the secret hash.
        // In the full protocol, this happens during sideload negotiation.
        // For now, we do a direct payment (no HTLC) since we already have delivery.
        //
        // Direct payment: simple DOGE tx to provider address with OP_RETURN metadata.
        const utxos = await this.config.getUtxos();
        const totalInput = utxos.reduce((sum, u) => sum + u.amount, 0);
        const totalNeeded = params.amountKoinu + DEFAULT_FEE_KOINU;
        if (totalInput < totalNeeded) {
            throw new Error(`Insufficient funds: have ${totalInput} koinu, need ${totalNeeded}`);
        }
        const tx = new Transaction();
        for (const utxo of utxos) {
            tx.from({
                txId: utxo.txid,
                outputIndex: utxo.vout,
                satoshis: utxo.amount,
                script: utxo.scriptPubKey,
            });
        }
        // Output 0: Payment to provider
        tx.to(params.providerAddress, params.amountKoinu);
        // Output 1: OP_RETURN with PAYMENT_COMPLETE
        const paymentMeta = encodeMessage({
            magic: QP_MAGIC,
            version: QP_VERSION,
            type: QPMessageType.PAYMENT_COMPLETE,
            payload: {
                sessionId: params.sessionId,
                deliveryHash: params.deliveryHash ?? Buffer.alloc(32),
                skillCode: params.skillCode,
                rating: 0, // rated separately
                ratingFlags: { tipIncluded: false, dispute: false },
                tipKoinu: 0,
                reserved: Buffer.alloc(32),
            },
        });
        tx.addOutput(new Transaction.Output({
            satoshis: 0,
            script: Script.buildDataOut(paymentMeta),
        }));
        tx.change(this.config.changeAddress);
        tx.fee(DEFAULT_FEE_KOINU);
        const signed = signTx(tx, this.config.privkey);
        const txHex = serializeTx(signed);
        const { txid } = await broadcastTx(this.config.provider, txHex);
        return { txId: txid };
    }
    // =========================================================================
    // Step 6: Rate
    // =========================================================================
    /**
     * Rate a provider on-chain.
     */
    async rateProvider(params) {
        this.assertNotDestroyed();
        const utxos = await this.config.getUtxos();
        if (!/^[0-9a-fA-F]{64}$/.test(params.paymentTxId)) {
            throw new Error('paymentTxId must be a 64-character hex string');
        }
        const paymentTxidBuf = Buffer.from(params.paymentTxId, 'hex');
        const tx = buildRatingTx({
            rating: {
                sessionId: params.sessionId,
                providerAddress: params.providerAddress,
                ratedAgent: params.providerPubkey,
                skillCode: params.skillCode,
                paymentTxid: paymentTxidBuf.length >= 32
                    ? paymentTxidBuf.subarray(0, 32)
                    : Buffer.concat([paymentTxidBuf, Buffer.alloc(32 - paymentTxidBuf.length)]),
                rating: params.rating,
                tipIncluded: params.tipIncluded ?? false,
                dispute: params.dispute ?? false,
            },
            utxos,
            changeAddress: this.config.changeAddress,
        });
        const signed = signTx(tx, this.config.privkey);
        const txHex = serializeTx(signed);
        const { txid } = await broadcastTx(this.config.provider, txHex);
        return { txId: txid };
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /** Get the service directory (discovered providers) */
    getDirectory() {
        return this.watcher.getDirectory();
    }
    /** Get active call count */
    get activeCallCount() {
        return this.activeCalls.size;
    }
    /** Clean up: zero keys, release resources */
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        // Zero private key
        this.config.privkey.fill(0);
        // Clean up active calls' session keys
        for (const call of this.activeCalls.values()) {
            if (call.sessionKey) {
                call.sessionKey.fill(0);
            }
        }
        this.activeCalls.clear();
        this.removeAllListeners();
    }
    assertNotDestroyed() {
        if (this.destroyed) {
            throw new Error('QPClient has been destroyed');
        }
    }
    emitEvent(callId, type, state, detail) {
        const call = this.activeCalls.get(callId);
        if (call) {
            call.state = state;
        }
        const event = {
            type,
            callId,
            state,
            detail,
            timestamp: Date.now(),
        };
        // Emit wildcard first (always safe)
        this.emit('*', event);
        // Emit typed event — guard 'error' to avoid unhandled error throw
        if (type === 'error' && this.listenerCount('error') === 0) {
            // No 'error' listener — skip to avoid Node.js uncaught error behavior
        }
        else {
            this.emit(type, event);
        }
    }
}
//# sourceMappingURL=client.js.map