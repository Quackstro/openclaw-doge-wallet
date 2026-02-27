/**
 * Sideload P2P Types
 * Encrypted off-chain communication for Quackstro Protocol
 */

/** Sideload transport protocol */
export enum SideloadProtocol {
  HTTPS = 0,
  LIBP2P = 1,
}

/** P2P connection details (encrypted in handshake) */
export interface SideloadConnectionInfo {
  /** Session ID (from handshake) */
  sessionId: number;
  /** Port number */
  port: number;
  /** IPv4 address (4 bytes) */
  ipv4: Buffer;
  /** Transport protocol */
  protocol: SideloadProtocol;
  /** Bearer auth token (8 bytes) */
  token: Buffer;
}

/** Sideload message types (§8.3) */
export type SideloadMessageType = 'request' | 'response' | 'chunk' | 'done' | 'error';

/** Sideload message envelope (§8.3) */
export interface SideloadMessage {
  /** Protocol version */
  v: number;
  /** Message type */
  t: SideloadMessageType;
  /** Message ID (UUID) */
  id: string;
  /** Reference to request ID (for responses) */
  ref?: string;
  /** Sequence number (for chunks) */
  seq?: number;
  /** Unix timestamp (seconds) */
  ts: number;
  /** Payload (binary or JSON) */
  body: Buffer | Record<string, unknown>;
  /** Optional metadata */
  meta?: SideloadMeta;
}

/** Message metadata (§8.3) */
export interface SideloadMeta {
  contentType?: string;
  totalChunks?: number;
  totalSize?: number;
  sha256?: string;
}

/** Encrypted wire format: iv (12) || ciphertext || tag (16) */
export interface EncryptedEnvelope {
  /** Initialization vector (12 bytes) */
  iv: Buffer;
  /** Encrypted message */
  ciphertext: Buffer;
  /** GCM authentication tag (16 bytes) */
  tag: Buffer;
}

/** Session state for tracking message counters */
export interface SideloadSession {
  /** Session ID */
  sessionId: number;
  /** Shared session key (32 bytes from HKDF) */
  sessionKey: Buffer;
  /** Our message counter (even for initiator, odd for responder) */
  sendCounter: bigint;
  /** Peer's expected counter */
  recvCounter: bigint;
  /** Our role */
  role: 'initiator' | 'responder';
  /** Remote connection info */
  remoteInfo: SideloadConnectionInfo;
  /** Session creation time */
  createdAt: number;
}
