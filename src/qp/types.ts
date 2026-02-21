/**
 * Quackstro Protocol Types
 * Binary message types for A2A economy on Dogecoin
 */

// Protocol constants
export const QP_MAGIC = 0x5150; // "QP" in ASCII
export const QP_VERSION = 0x01;
export const QP_PAYLOAD_SIZE = 76; // 80 - 4 byte header
export const QP_MESSAGE_SIZE = 80;

// Message types (§5.3)
export enum QPMessageType {
  SERVICE_ADVERTISE = 0x01,
  SERVICE_REQUEST = 0x02,
  HANDSHAKE_INIT = 0x03,
  HANDSHAKE_ACK = 0x04,
  DELIVERY_RECEIPT = 0x05,
  PAYMENT_COMPLETE = 0x06,
  RATING = 0x07,
  REVOKE_SERVICE = 0x08,
  PUBKEY_ANNOUNCE = 0x09,
  HTLC_OFFER = 0x0a,
  HTLC_CLAIM = 0x0b,
  CHANNEL_OPEN = 0x0c,
  CHANNEL_CLOSE = 0x0d,
  // 0x0E reserved
  KEY_ROTATION = 0x0f,
  AGENT_RETIRED = 0x10,
}

// Price units (§5.4.1)
export enum PriceUnit {
  PER_REQUEST = 0,
  PER_KB = 1,
  PER_HOUR = 2,
  PER_1K_TOKENS = 3,
  FLAT_RATE = 4,
  NEGOTIABLE = 5,
}

// SERVICE_ADVERTISE flags (§5.4.1)
export interface AdvertiseFlags {
  supportsDirectHtlc: boolean;      // bit 0
  supportsSideloadHttps: boolean;   // bit 1
  supportsSideloadLibp2p: boolean;  // bit 2
  supportsSideloadIpfs: boolean;    // bit 3
  onlineNow: boolean;               // bit 4
  supportsPaymentChannel: boolean;  // bit 5
  acceptsPostPayment: boolean;      // bit 6
  isCompositeTool: boolean;         // bit 7
}

// Rating flags (§5.4.6)
export interface RatingFlags {
  tipIncluded: boolean;    // bit 0
  dispute: boolean;        // bit 1
}

// Channel close types (§5.4.13)
export enum ChannelCloseType {
  COOPERATIVE = 0,
  UNILATERAL_CONSUMER = 1,
  UNILATERAL_PROVIDER = 2,
  TIMEOUT = 3,
}

// Agent types (§5.4.9)
export enum AgentType {
  PROVIDER = 0,
  CONSUMER = 1,
  BOTH = 2,
}

// Agent retired reason codes (§5.4.15)
export enum RetiredReason {
  UNSPECIFIED = 0,
  PLANNED = 1,
  COMPROMISED = 2,
  MIGRATING = 3,
}

// Sideload protocol types
export enum SideloadProtocol {
  HTTPS = 0,
  LIBP2P = 1,
}

// ============================================
// Message Payloads
// ============================================

export interface ServiceAdvertisePayload {
  skillCode: number;        // uint16
  priceKoinu: number;       // uint32 (max ~42.9 DOGE)
  priceUnit: PriceUnit;
  flags: AdvertiseFlags;
  ttlBlocks: number;        // uint16
  nonce: Buffer;            // 4 bytes
  pubkey: Buffer;           // 33 bytes (compressed secp256k1)
  metadata: string;         // 20 chars UTF-8 description
}

export interface ServiceRequestPayload {
  skillCode: number;
  budgetKoinu: number;
  urgency: number;          // 0=normal, 1=high, 2=critical
  sideloadPrefs: number;    // bitfield (same as flags)
  nonce: Buffer;
  pubkey: Buffer;
  jobDesc: string;          // 31 chars
}

export interface HandshakeInitPayload {
  ephemeralPubkey: Buffer;  // 33 bytes
  timestamp: number;        // uint32 (unix seconds)
  nonce: Buffer;            // 4 bytes
  encryptedData: Buffer;    // 35 bytes (19 plaintext + 16 tag)
}

export interface HandshakeAckPayload {
  ephemeralPubkey: Buffer;
  sessionId: number;        // uint32
  nonce: Buffer;
  encryptedData: Buffer;
}

export interface DeliveryReceiptPayload {
  sessionId: number;
  deliveryHash: Buffer;     // 32 bytes SHA-256
  timestamp: number;
  skillCode: number;
  sizeBytes: number;
  ipfsCidHash: Buffer;      // 30 bytes (SHA-256(full_CID)[0:30])
}

export interface PaymentCompletePayload {
  sessionId: number;
  deliveryHash: Buffer;
  skillCode: number;
  rating: number;           // 0-5
  ratingFlags: RatingFlags;
  tipKoinu: number;
  reserved: Buffer;         // 32 bytes
}

export interface RatingPayload {
  sessionId: number;
  ratedAgent: Buffer;       // 33 bytes pubkey
  rating: number;
  flags: RatingFlags;
  skillCode: number;
  paymentTxid: Buffer;      // 32 bytes
  reserved: Buffer;         // 3 bytes
}

export interface RevokeServicePayload {
  skillCode: number;
  adTxid: Buffer;           // 32 bytes
  timestamp: number;
  reserved: Buffer;         // 38 bytes
}

export interface PubkeyAnnouncePayload {
  pubkey: Buffer;
  timestamp: number;
  agentType: AgentType;
  agentName: string;        // 20 chars
  metadata: Buffer;         // 18 bytes
}

export interface HtlcOfferPayload {
  sessionId: number;
  secretHash: Buffer;       // 20 bytes (HASH160)
  timeoutBlock: number;     // uint32
  toolPrice: number;
  feeBuffer: number;
  skillCode: number;
  consumerPubkey: Buffer;   // 33 bytes
  reserved: Buffer;         // 5 bytes
}

export interface HtlcClaimPayload {
  sessionId: number;
  fundingTxid: Buffer;      // 32 bytes
  claimedKoinu: number;
  timestamp: number;
  reserved: Buffer;         // 32 bytes
}

export interface ChannelOpenPayload {
  channelId: number;
  consumerPubkey: Buffer;   // 33 bytes
  providerPubkey: Buffer;   // 33 bytes
  ttlBlocks: number;        // uint16
  depositKoinu: number;
}

export interface ChannelClosePayload {
  channelId: number;
  fundingTxid: Buffer;      // 32 bytes
  consumerFinal: number;
  providerFinal: number;
  callCount: number;
  closeType: ChannelCloseType;
  timestamp: number;
  reserved: Buffer;         // 23 bytes
}

export interface KeyRotationPayload {
  oldPubkey: Buffer;        // 33 bytes
  newPubkey: Buffer;        // 33 bytes
  timestamp: number;
  nonce: Buffer;            // 4 bytes
  reserved: Buffer;         // 2 bytes
}

export interface AgentRetiredPayload {
  pubkey: Buffer;           // 33 bytes
  timestamp: number;
  reasonCode: RetiredReason;
  successor: Buffer;        // 33 bytes (or zeros)
  reserved: Buffer;         // 5 bytes
}

// Union type for all payloads
export type QPPayload =
  | ServiceAdvertisePayload
  | ServiceRequestPayload
  | HandshakeInitPayload
  | HandshakeAckPayload
  | DeliveryReceiptPayload
  | PaymentCompletePayload
  | RatingPayload
  | RevokeServicePayload
  | PubkeyAnnouncePayload
  | HtlcOfferPayload
  | HtlcClaimPayload
  | ChannelOpenPayload
  | ChannelClosePayload
  | KeyRotationPayload
  | AgentRetiredPayload;

// Full message with envelope
export interface QPMessage<T extends QPPayload = QPPayload> {
  magic: number;
  version: number;
  type: QPMessageType;
  payload: T;
}

// ============================================
// Skill Codes (§13)
// ============================================

export enum SkillCategory {
  RESERVED = 0x00,
  TEXT_LANGUAGE = 0x01,     // 0x0100-0x01FF
  CODE_DEVELOPMENT = 0x02,  // 0x0200-0x02FF
  DATA_ANALYTICS = 0x03,    // 0x0300-0x03FF
  MEDIA = 0x04,             // 0x0400-0x04FF
  RESEARCH = 0x05,          // 0x0500-0x05FF
  INFRASTRUCTURE = 0x06,    // 0x0600-0x06FF
  FINANCE = 0x07,           // 0x0700-0x07FF
  SECURITY = 0x08,          // 0x0800-0x08FF
  COMMUNICATION = 0x09,     // 0x0900-0x09FF
  DOMAIN_SPECIFIC = 0x0a,   // 0x0A00-0x0AFF
  EXPERIMENTAL = 0xf0,      // 0xF000-0xFFFE
}

// Common skill codes
export const SkillCodes = {
  // Reserved
  ARBITER: 0x0004,
  
  // Text & Language
  TRANSLATION: 0x0100,
  SUMMARIZATION: 0x0101,
  WRITING: 0x0102,
  
  // Code & Development
  CODE_REVIEW: 0x0200,
  CODE_GENERATION: 0x0201,
  
  // Data & Analytics
  SCRAPING: 0x0300,
  ANALYSIS: 0x0301,
  
  // Media
  IMAGE_GEN: 0x0400,
  OCR: 0x0403,
  
  // Wildcard
  ANY: 0xffff,
} as const;

// Registry categories
export const RegistryCategories = ['general', 'compute', 'data', 'content', 'identity'] as const;
export type RegistryCategory = typeof RegistryCategories[number];
