/**
 * QP Provider — Service provider handler
 *
 * Advertises skills on-chain, handles incoming handshakes,
 * processes sideload requests, and claims payments.
 */

import { randomBytes } from 'crypto';
import { EventEmitter } from 'node:events';

import {
  ecdhSharedSecret,
  deriveHandshakeKey,
  deriveSessionKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
  deriveIv,
  generateEphemeralKeyPair,
} from '../crypto.js';
import {
  encodeMessage,
} from '../messages.js';
import {
  QPMessageType,
  QP_MAGIC,
  QP_VERSION,
} from '../types.js';
import type {
  HandshakeInitPayload,
  HandshakeAckPayload,
  AdvertiseFlags,
} from '../types.js';
import type { SideloadConnectionInfo } from '../sideload/types.js';
import { SideloadProtocol } from '../sideload/types.js';
import type { SideloadMessage } from '../sideload/types.js';
import { scanAddress } from '../chain/scanner.js';
import type { OnChainQPMessage } from '../chain/types.js';
import {
  buildAdvertiseTx,
  signTx,
  serializeTx,
  broadcastTx,
} from '../chain/tx-builder.js';
import type { AdvertiseParams } from '../chain/tx-builder.js';
import {
  HTLCProviderManager,
  InMemoryHTLCStorage,
} from '../htlc/manager.js';
import { SessionManager } from '../sideload/session-manager.js';

import type {
  ProviderConfig,
  SkillRegistration,
  OrchestratorEvent,
  OrchestratorEventType,
  SideloadTransport,
} from './types.js';
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
// Active session tracking
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// QPProvider
// ---------------------------------------------------------------------------

export class QPProvider extends EventEmitter {
  private config: ProviderConfig;
  private htlcStorage = new InMemoryHTLCStorage();
  private htlcManager: HTLCProviderManager;
  private sessions: Map<number, ActiveSession> = new Map();
  private skillHandlers: Map<number, SkillRegistration> = new Map();
  private scanTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private destroyed = false;

  constructor(config: ProviderConfig) {
    super();
    this.config = {
      advertiseTtlBlocks: DEFAULT_ADVERTISE_TTL_BLOCKS,
      scanIntervalMs: DEFAULT_SCAN_INTERVAL_MS,
      ...config,
    };

    this.htlcManager = new HTLCProviderManager(
      this.htlcStorage,
      config.pubkey,
      config.privkey,
      config.address,
    );

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
  async advertise(): Promise<string[]> {
    this.assertNotDestroyed();
    const txIds: string[] = [];

    for (const skill of this.config.skills) {
      const params: AdvertiseParams = {
        skillCode: skill.skillCode,
        priceKoinu: skill.priceKoinu,
        priceUnit: skill.priceUnit,
        flags: skill.flags,
        ttlBlocks: this.config.advertiseTtlBlocks!,
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
  start(): void {
    this.assertNotDestroyed();
    if (this.running) return;
    this.running = true;

    this.scanTimer = setInterval(async () => {
      try {
        await this.scanForHandshakes();
      } catch (err) {
        this.emitEvent('scan-error', 'error', CallState.FAILED, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.config.scanIntervalMs!);
  }

  /** Stop listening */
  stop(): void {
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
  async scanForHandshakes(): Promise<void> {
    this.assertNotDestroyed();

    const messages = await scanAddress(
      this.config.provider,
      this.config.address,
      20,
      { messageTypes: [QPMessageType.HANDSHAKE_INIT] },
    );

    for (const msg of messages) {
      try {
        await this.handleHandshakeInit(msg);
      } catch {
        // Skip invalid/undecodable handshakes
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
  async handleHandshakeInit(msg: OnChainQPMessage): Promise<void> {
    this.assertNotDestroyed();

    const payload = msg.message.payload as HandshakeInitPayload;

    // Step 1: Decrypt consumer's P2P details
    const initSecret = ecdhSharedSecret(this.config.privkey, payload.ephemeralPubkey);
    const encKey = deriveHandshakeKey(initSecret, payload.nonce);
    const iv = deriveIv(payload.nonce, payload.timestamp);

    const ct = payload.encryptedData.subarray(0, payload.encryptedData.length - 16);
    const tag = payload.encryptedData.subarray(payload.encryptedData.length - 16);
    const plaintext = aesGcmDecrypt(encKey, iv, ct, tag);
    const consumerDetails = JSON.parse(plaintext.toString('utf8'));

    const sessionId = consumerDetails.session_id;

    // Skip if we already have this session
    if (this.sessions.has(sessionId)) return;

    const consumerInfo: SideloadConnectionInfo = {
      sessionId,
      port: consumerDetails.port,
      ipv4: Buffer.from(consumerDetails.ipv4),
      protocol: consumerDetails.protocol,
      token: Buffer.from(consumerDetails.token, 'hex'),
    };

    // Step 2: Generate our ephemeral key pair
    const ephemeral = generateEphemeralKeyPair();

    // Step 3: Compute session key
    const sessionSecret = ecdhSharedSecret(ephemeral.privateKey, payload.ephemeralPubkey);
    const sessionKey = deriveSessionKey(sessionSecret, sessionId);

    // Step 4: Encrypt our P2P details
    const ackNonce = randomBytes(4);
    const ackEncKey = deriveHandshakeKey(
      ecdhSharedSecret(ephemeral.privateKey, payload.ephemeralPubkey),
      ackNonce,
    );
    const ackIv = deriveIv(ackNonce, sessionId);

    const ourInfo: SideloadConnectionInfo = {
      sessionId,
      port: 8443,
      ipv4: Buffer.from([0, 0, 0, 0]),
      protocol: SideloadProtocol.HTTPS,
      token: randomBytes(8),
    };

    const ackPlaintext = Buffer.from(JSON.stringify({
      session_id: sessionId,
      port: ourInfo.port,
      ipv4: Array.from(ourInfo.ipv4),
      protocol: ourInfo.protocol,
      token: ourInfo.token.toString('hex'),
    }));

    const { ciphertext, tag: ackTag } = aesGcmEncrypt(ackEncKey, ackIv, ackPlaintext);
    const encryptedData = Buffer.concat([ciphertext, ackTag]);

    // Step 5: Build and broadcast HANDSHAKE_ACK
    const ackPayload: HandshakeAckPayload = {
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

    // Zero ephemeral private key
    ephemeral.privateKey.fill(0);

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
  async handleRequest(
    sessionId: number,
    wire: Buffer,
    transport: SideloadTransport,
  ): Promise<void> {
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
    const body = message.body as Record<string, unknown>;
    const skillCode = (body.skillCode as number) ?? session.skillCode;

    const handler = skillCode !== undefined ? this.skillHandlers.get(skillCode) : undefined;

    if (!handler) {
      // Send error
      const errorWire = session.sessionManager.buildError(
        message.id,
        { error: 'unknown_skill', message: `Skill 0x${(skillCode ?? 0).toString(16)} not supported` },
      );
      await transport.send(session.remoteInfo, errorWire);
      return;
    }

    try {
      // Execute handler
      const result = await handler.handler(body);

      // Build encrypted response
      const responseWire = session.sessionManager.buildResponse(
        message.id,
        result,
      );

      // Send back via transport
      await transport.send(session.remoteInfo, responseWire);

      this.emitEvent(`session-${sessionId}`, 'delivery_received', CallState.COMPLETE, {
        skillCode,
        messageId: message.id,
      });
    } catch (err) {
      const errorWire = session.sessionManager.buildError(
        message.id,
        { error: 'handler_error', message: err instanceof Error ? err.message : String(err) },
      );
      await transport.send(session.remoteInfo, errorWire);
    }
  }

  // =========================================================================
  // Payment claiming
  // =========================================================================

  /**
   * Check for and claim any pending HTLC payments.
   */
  async claimPayments(): Promise<string[]> {
    this.assertNotDestroyed();
    const pending = await this.htlcManager.getPendingHTLCs();
    const claimed: string[] = [];

    for (const htlc of pending) {
      try {
        const result = await this.htlcManager.claim(htlc.id);
        const { txid } = await broadcastTx(this.config.provider, result.claimTx);
        claimed.push(txid);
      } catch {
        // Skip — may not be claimable yet
      }
    }

    return claimed;
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  /** Get active session count */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Get a session by ID */
  getSession(sessionId: number): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Clean up: zero keys, close sessions, stop scanning */
  destroy(): void {
    if (this.destroyed) return;
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

  private assertNotDestroyed(): void {
    if (this.destroyed) {
      throw new Error('QPProvider has been destroyed');
    }
  }

  private emitEvent(
    callId: string,
    type: OrchestratorEventType,
    state: CallState,
    detail?: unknown,
  ): void {
    const event: OrchestratorEvent = {
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
    } else {
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
function skillToCategory(skillCode: number): 'general' | 'compute' | 'data' | 'content' | 'identity' {
  const range = (skillCode >> 8) & 0xff;
  switch (range) {
    case 0x00: return 'general';
    case 0x01: return 'general';   // text & language → general
    case 0x02: return 'compute';   // code & development → compute
    case 0x03: return 'data';      // data & analytics → data
    case 0x04: return 'content';   // media → content
    case 0x05: return 'general';   // research → general
    case 0x06: return 'compute';   // infrastructure → compute
    case 0x07: return 'general';   // finance → general
    case 0x08: return 'compute';   // security → compute
    default:   return 'general';
  }
}
