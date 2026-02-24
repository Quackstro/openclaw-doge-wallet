/**
 * Sideload Encrypted Envelope
 * AES-256-GCM encryption with counter-based IV derivation (§8.3)
 */
import type { SideloadMessage, SideloadMessageType, SideloadMeta, EncryptedEnvelope, SideloadSession, SideloadConnectionInfo } from './types.js';
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
export declare function deriveIV(sessionKey: Buffer, counter: bigint): Buffer;
/**
 * Create a new SideloadMessage.
 */
export declare function createMessage(params: {
    type: SideloadMessageType;
    body: Buffer | Record<string, unknown>;
    ref?: string;
    seq?: number;
    meta?: SideloadMeta;
}): SideloadMessage;
/**
 * Serialize a SideloadMessage to JSON bytes.
 */
export declare function serializeMessage(msg: SideloadMessage): Buffer;
/**
 * Deserialize JSON bytes to a SideloadMessage.
 * Validates schema to prevent prototype pollution and reject malformed data.
 */
export declare function deserializeMessage(data: Buffer): SideloadMessage;
/**
 * Encrypt a message using AES-256-GCM with counter-based IV.
 */
export declare function encryptMessage(session: SideloadSession, msg: SideloadMessage): {
    envelope: EncryptedEnvelope;
    nextCounter: bigint;
};
/**
 * Decrypt an encrypted envelope using AES-256-GCM.
 */
export declare function decryptMessage(session: SideloadSession, envelope: EncryptedEnvelope): {
    message: SideloadMessage;
    nextCounter: bigint;
};
/**
 * Serialize an EncryptedEnvelope to wire format.
 * Format: iv (12) || ciphertext (variable) || tag (16)
 */
export declare function envelopeToWire(envelope: EncryptedEnvelope): Buffer;
/**
 * Deserialize wire bytes to EncryptedEnvelope.
 */
export declare function wireToEnvelope(wire: Buffer): EncryptedEnvelope;
/**
 * Zero out sensitive session key material.
 * Call this when the session is no longer needed.
 */
export declare function destroySession(session: SideloadSession): void;
/**
 * Create a new SideloadSession.
 */
export declare function createSession(params: {
    sessionId: number;
    sessionKey: Buffer;
    role: 'initiator' | 'responder';
    remoteInfo: SideloadConnectionInfo;
}): SideloadSession;
//# sourceMappingURL=envelope.d.ts.map