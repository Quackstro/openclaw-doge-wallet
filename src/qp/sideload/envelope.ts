/**
 * Sideload Encrypted Envelope
 * AES-256-GCM encryption with counter-based IV derivation (§8.3)
 */

import { createCipheriv, createDecipheriv, randomUUID } from 'crypto';
import { sha256 } from '../crypto.js';
import type {
  SideloadMessage,
  SideloadMessageType,
  SideloadMeta,
  EncryptedEnvelope,
  SideloadSession,
  SideloadConnectionInfo,
} from './types.js';

/**
 * Derive a unique IV from session key and message counter (§8.3).
 *
 * iv = SHA-256(session_key)[0:4] || counter[0:8]
 *
 * First 4 bytes: derived from session key (unique per session)
 * Last 8 bytes: 64-bit message counter (BigInt, big-endian)
 *
 * This guarantees IV uniqueness across ~2^63 messages per session.
 */
export function deriveIV(sessionKey: Buffer, counter: bigint): Buffer {
  const keyHash = sha256(sessionKey);
  const iv = Buffer.alloc(12);

  // First 4 bytes from key hash
  keyHash.copy(iv, 0, 0, 4);

  // Last 8 bytes from counter (big-endian)
  iv.writeBigUInt64BE(counter, 4);

  return iv;
}

/**
 * Create a new SideloadMessage.
 */
export function createMessage(params: {
  type: SideloadMessageType;
  body: Buffer | Record<string, unknown>;
  ref?: string;
  seq?: number;
  meta?: SideloadMeta;
}): SideloadMessage {
  return {
    v: 1,
    t: params.type,
    id: randomUUID(),
    ref: params.ref,
    seq: params.seq,
    ts: Math.floor(Date.now() / 1000),
    body: params.body,
    meta: params.meta,
  };
}

/**
 * Serialize a SideloadMessage to JSON bytes.
 */
export function serializeMessage(msg: SideloadMessage): Buffer {
  // Convert Buffer body to base64 for JSON serialization
  const serializable = {
    ...msg,
    body: Buffer.isBuffer(msg.body) ? msg.body.toString('base64') : msg.body,
    _bodyEncoding: Buffer.isBuffer(msg.body) ? 'base64' : undefined,
  };
  return Buffer.from(JSON.stringify(serializable), 'utf8');
}

/**
 * Deserialize JSON bytes to a SideloadMessage.
 */
export function deserializeMessage(data: Buffer): SideloadMessage {
  const parsed = JSON.parse(data.toString('utf8'));

  // Restore Buffer body from base64
  if (parsed._bodyEncoding === 'base64' && typeof parsed.body === 'string') {
    parsed.body = Buffer.from(parsed.body, 'base64');
    delete parsed._bodyEncoding;
  }

  return parsed as SideloadMessage;
}

/**
 * Encrypt a message using AES-256-GCM with counter-based IV.
 */
export function encryptMessage(
  session: SideloadSession,
  msg: SideloadMessage
): { envelope: EncryptedEnvelope; nextCounter: bigint } {
  const plaintext = serializeMessage(msg);
  const iv = deriveIV(session.sessionKey, session.sendCounter);

  const cipher = createCipheriv('aes-256-gcm', session.sessionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Counter increments by 2 (odd/even separation)
  const nextCounter = session.sendCounter + 2n;

  return {
    envelope: { iv, ciphertext, tag },
    nextCounter,
  };
}

/**
 * Decrypt an encrypted envelope using AES-256-GCM.
 */
export function decryptMessage(
  session: SideloadSession,
  envelope: EncryptedEnvelope
): { message: SideloadMessage; nextCounter: bigint } {
  // Verify the IV matches expected counter
  const expectedIV = deriveIV(session.sessionKey, session.recvCounter);
  if (!envelope.iv.equals(expectedIV)) {
    throw new Error(
      `IV mismatch: possible replay attack or out-of-order message ` +
      `(expected counter ${session.recvCounter})`
    );
  }

  const decipher = createDecipheriv('aes-256-gcm', session.sessionKey, envelope.iv);
  decipher.setAuthTag(envelope.tag);
  const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);

  const message = deserializeMessage(plaintext);

  // Counter increments by 2
  const nextCounter = session.recvCounter + 2n;

  return { message, nextCounter };
}

/**
 * Serialize an EncryptedEnvelope to wire format.
 * Format: iv (12) || ciphertext (variable) || tag (16)
 */
export function envelopeToWire(envelope: EncryptedEnvelope): Buffer {
  return Buffer.concat([envelope.iv, envelope.ciphertext, envelope.tag]);
}

/**
 * Deserialize wire bytes to EncryptedEnvelope.
 */
export function wireToEnvelope(wire: Buffer): EncryptedEnvelope {
  if (wire.length < 28) {
    throw new Error(`Wire data too short: ${wire.length} bytes (min 28 = 12 iv + 0 ct + 16 tag)`);
  }

  const iv = wire.subarray(0, 12);
  const tag = wire.subarray(wire.length - 16);
  const ciphertext = wire.subarray(12, wire.length - 16);

  return {
    iv: Buffer.from(iv),
    ciphertext: Buffer.from(ciphertext),
    tag: Buffer.from(tag),
  };
}

/**
 * Create a new SideloadSession.
 */
export function createSession(params: {
  sessionId: number;
  sessionKey: Buffer;
  role: 'initiator' | 'responder';
  remoteInfo: SideloadConnectionInfo;
}): SideloadSession {
  if (params.sessionKey.length !== 32) {
    throw new Error('Session key must be 32 bytes');
  }

  return {
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    // Initiator starts at counter 0 (even), responder at 1 (odd)
    sendCounter: params.role === 'initiator' ? 0n : 1n,
    // Expect peer's first counter
    recvCounter: params.role === 'initiator' ? 1n : 0n,
    role: params.role,
    remoteInfo: params.remoteInfo,
    createdAt: Date.now(),
  };
}
