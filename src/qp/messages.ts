/**
 * Quackstro Protocol Message Encoder/Decoder
 * Binary serialization for all QP message types (§5)
 */

import {
  QP_MAGIC,
  QP_VERSION,
  QP_PAYLOAD_SIZE,
  QP_MESSAGE_SIZE,
  QPMessageType,
  PriceUnit,
  AgentType,
  ChannelCloseType,
  RetiredReason,
  type QPMessage,
  type QPPayload,
  type ServiceAdvertisePayload,
  type ServiceRequestPayload,
  type HandshakeInitPayload,
  type HandshakeAckPayload,
  type DeliveryReceiptPayload,
  type PaymentCompletePayload,
  type RatingPayload,
  type RevokeServicePayload,
  type PubkeyAnnouncePayload,
  type HtlcOfferPayload,
  type HtlcClaimPayload,
  type ChannelOpenPayload,
  type ChannelClosePayload,
  type KeyRotationPayload,
  type AgentRetiredPayload,
  type AdvertiseFlags,
  type RatingFlags,
} from './types.js';

// ============================================
// Flag Serialization Helpers
// ============================================

function encodeAdvertiseFlags(flags: AdvertiseFlags): number {
  let byte = 0;
  if (flags.supportsDirectHtlc) byte |= 0x01;
  if (flags.supportsSideloadHttps) byte |= 0x02;
  if (flags.supportsSideloadLibp2p) byte |= 0x04;
  if (flags.supportsSideloadIpfs) byte |= 0x08;
  if (flags.onlineNow) byte |= 0x10;
  if (flags.supportsPaymentChannel) byte |= 0x20;
  if (flags.acceptsPostPayment) byte |= 0x40;
  if (flags.isCompositeTool) byte |= 0x80;
  return byte;
}

function decodeAdvertiseFlags(byte: number): AdvertiseFlags {
  return {
    supportsDirectHtlc: (byte & 0x01) !== 0,
    supportsSideloadHttps: (byte & 0x02) !== 0,
    supportsSideloadLibp2p: (byte & 0x04) !== 0,
    supportsSideloadIpfs: (byte & 0x08) !== 0,
    onlineNow: (byte & 0x10) !== 0,
    supportsPaymentChannel: (byte & 0x20) !== 0,
    acceptsPostPayment: (byte & 0x40) !== 0,
    isCompositeTool: (byte & 0x80) !== 0,
  };
}

function encodeRatingFlags(flags: RatingFlags): number {
  let byte = 0;
  if (flags.tipIncluded) byte |= 0x01;
  if (flags.dispute) byte |= 0x02;
  return byte;
}

function decodeRatingFlags(byte: number): RatingFlags {
  return {
    tipIncluded: (byte & 0x01) !== 0,
    dispute: (byte & 0x02) !== 0,
  };
}

// ============================================
// Message Encoding
// ============================================

/**
 * Encode a QP message to an 80-byte buffer (for OP_RETURN)
 */
export function encodeMessage<T extends QPPayload>(message: QPMessage<T>): Buffer {
  const buffer = Buffer.alloc(QP_MESSAGE_SIZE);
  
  // Header (4 bytes)
  buffer.writeUInt16BE(QP_MAGIC, 0);
  buffer.writeUInt8(QP_VERSION, 2);
  buffer.writeUInt8(message.type, 3);
  
  // Payload (76 bytes)
  const payload = encodePayload(message.type, message.payload);
  payload.copy(buffer, 4);
  
  return buffer;
}

function encodePayload(type: QPMessageType, payload: QPPayload): Buffer {
  switch (type) {
    case QPMessageType.SERVICE_ADVERTISE:
      return encodeServiceAdvertise(payload as ServiceAdvertisePayload);
    case QPMessageType.SERVICE_REQUEST:
      return encodeServiceRequest(payload as ServiceRequestPayload);
    case QPMessageType.HANDSHAKE_INIT:
      return encodeHandshakeInit(payload as HandshakeInitPayload);
    case QPMessageType.HANDSHAKE_ACK:
      return encodeHandshakeAck(payload as HandshakeAckPayload);
    case QPMessageType.DELIVERY_RECEIPT:
      return encodeDeliveryReceipt(payload as DeliveryReceiptPayload);
    case QPMessageType.PAYMENT_COMPLETE:
      return encodePaymentComplete(payload as PaymentCompletePayload);
    case QPMessageType.RATING:
      return encodeRating(payload as RatingPayload);
    case QPMessageType.REVOKE_SERVICE:
      return encodeRevokeService(payload as RevokeServicePayload);
    case QPMessageType.PUBKEY_ANNOUNCE:
      return encodePubkeyAnnounce(payload as PubkeyAnnouncePayload);
    case QPMessageType.HTLC_OFFER:
      return encodeHtlcOffer(payload as HtlcOfferPayload);
    case QPMessageType.HTLC_CLAIM:
      return encodeHtlcClaim(payload as HtlcClaimPayload);
    case QPMessageType.CHANNEL_OPEN:
      return encodeChannelOpen(payload as ChannelOpenPayload);
    case QPMessageType.CHANNEL_CLOSE:
      return encodeChannelClose(payload as ChannelClosePayload);
    case QPMessageType.KEY_ROTATION:
      return encodeKeyRotation(payload as KeyRotationPayload);
    case QPMessageType.AGENT_RETIRED:
      return encodeAgentRetired(payload as AgentRetiredPayload);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

// SERVICE_ADVERTISE (§5.4.1)
function encodeServiceAdvertise(p: ServiceAdvertisePayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  buf.writeUInt32BE(p.priceKoinu, offset); offset += 4;
  buf.writeUInt8(p.priceUnit, offset); offset += 1;
  buf.writeUInt8(encodeAdvertiseFlags(p.flags), offset); offset += 1;
  buf.writeUInt16BE(p.ttlBlocks, offset); offset += 2;
  p.nonce.copy(buf, offset, 0, 4); offset += 4;
  p.pubkey.copy(buf, offset, 0, 33); offset += 33;
  
  // Metadata: 20 chars + 9 reserved
  const metadataBytes = Buffer.from(p.metadata.slice(0, 20).padEnd(20, '\0'), 'utf8');
  metadataBytes.copy(buf, offset, 0, 20); offset += 20;
  // Reserved 9 bytes already zero
  
  return buf;
}

// SERVICE_REQUEST (§5.4.2)
function encodeServiceRequest(p: ServiceRequestPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  buf.writeUInt32BE(p.budgetKoinu, offset); offset += 4;
  buf.writeUInt8(p.urgency, offset); offset += 1;
  buf.writeUInt8(p.sideloadPrefs, offset); offset += 1;
  p.nonce.copy(buf, offset, 0, 4); offset += 4;
  p.pubkey.copy(buf, offset, 0, 33); offset += 33;
  
  const jobDescBytes = Buffer.from(p.jobDesc.slice(0, 31).padEnd(31, '\0'), 'utf8');
  jobDescBytes.copy(buf, offset, 0, 31);
  
  return buf;
}

// HANDSHAKE_INIT (§5.4.3)
function encodeHandshakeInit(p: HandshakeInitPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  p.ephemeralPubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  p.nonce.copy(buf, offset, 0, 4); offset += 4;
  p.encryptedData.copy(buf, offset, 0, 35); // 19 bytes ciphertext + 16 bytes tag
  
  return buf;
}

// HANDSHAKE_ACK (§5.4.4)
function encodeHandshakeAck(p: HandshakeAckPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  p.ephemeralPubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.nonce.copy(buf, offset, 0, 4); offset += 4;
  p.encryptedData.copy(buf, offset, 0, 35);
  
  return buf;
}

// DELIVERY_RECEIPT (§5.4.5)
function encodeDeliveryReceipt(p: DeliveryReceiptPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.deliveryHash.copy(buf, offset, 0, 32); offset += 32;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  buf.writeUInt32BE(p.sizeBytes, offset); offset += 4;
  p.ipfsCidHash.copy(buf, offset, 0, 30);
  
  return buf;
}

// PAYMENT_COMPLETE (§5.4.6)
function encodePaymentComplete(p: PaymentCompletePayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.deliveryHash.copy(buf, offset, 0, 32); offset += 32;
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  buf.writeUInt8(p.rating, offset); offset += 1;
  buf.writeUInt8(encodeRatingFlags(p.ratingFlags), offset); offset += 1;
  buf.writeUInt32BE(p.tipKoinu, offset); offset += 4;
  p.reserved.copy(buf, offset, 0, 32);
  
  return buf;
}

// RATING (§5.4.7)
function encodeRating(p: RatingPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.ratedAgent.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt8(p.rating, offset); offset += 1;
  buf.writeUInt8(encodeRatingFlags(p.flags), offset); offset += 1;
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  p.paymentTxid.copy(buf, offset, 0, 32); offset += 32;
  p.reserved.copy(buf, offset, 0, 3);
  
  return buf;
}

// REVOKE_SERVICE (§5.4.8)
function encodeRevokeService(p: RevokeServicePayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  p.adTxid.copy(buf, offset, 0, 32); offset += 32;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  p.reserved.copy(buf, offset, 0, 38);
  
  return buf;
}

// PUBKEY_ANNOUNCE (§5.4.9)
function encodePubkeyAnnounce(p: PubkeyAnnouncePayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  p.pubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  buf.writeUInt8(p.agentType, offset); offset += 1;
  
  const nameBytes = Buffer.from(p.agentName.slice(0, 20).padEnd(20, '\0'), 'utf8');
  nameBytes.copy(buf, offset, 0, 20); offset += 20;
  p.metadata.copy(buf, offset, 0, 18);
  
  return buf;
}

// HTLC_OFFER (§5.4.10)
function encodeHtlcOffer(p: HtlcOfferPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.secretHash.copy(buf, offset, 0, 20); offset += 20;
  buf.writeUInt32BE(p.timeoutBlock, offset); offset += 4;
  buf.writeUInt32BE(p.toolPrice, offset); offset += 4;
  buf.writeUInt32BE(p.feeBuffer, offset); offset += 4;
  buf.writeUInt16BE(p.skillCode, offset); offset += 2;
  p.consumerPubkey.copy(buf, offset, 0, 33); offset += 33;
  p.reserved.copy(buf, offset, 0, 5);
  
  return buf;
}

// HTLC_CLAIM (§5.4.11)
function encodeHtlcClaim(p: HtlcClaimPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.sessionId, offset); offset += 4;
  p.fundingTxid.copy(buf, offset, 0, 32); offset += 32;
  buf.writeUInt32BE(p.claimedKoinu, offset); offset += 4;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  p.reserved.copy(buf, offset, 0, 32);
  
  return buf;
}

// CHANNEL_OPEN (§5.4.12)
function encodeChannelOpen(p: ChannelOpenPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.channelId, offset); offset += 4;
  p.consumerPubkey.copy(buf, offset, 0, 33); offset += 33;
  p.providerPubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt16BE(p.ttlBlocks, offset); offset += 2;
  buf.writeUInt32BE(p.depositKoinu, offset);
  
  return buf;
}

// CHANNEL_CLOSE (§5.4.13)
function encodeChannelClose(p: ChannelClosePayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  buf.writeUInt32BE(p.channelId, offset); offset += 4;
  p.fundingTxid.copy(buf, offset, 0, 32); offset += 32;
  buf.writeUInt32BE(p.consumerFinal, offset); offset += 4;
  buf.writeUInt32BE(p.providerFinal, offset); offset += 4;
  buf.writeUInt32BE(p.callCount, offset); offset += 4;
  buf.writeUInt8(p.closeType, offset); offset += 1;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  p.reserved.copy(buf, offset, 0, 23);
  
  return buf;
}

// KEY_ROTATION (§5.4.14)
function encodeKeyRotation(p: KeyRotationPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  p.oldPubkey.copy(buf, offset, 0, 33); offset += 33;
  p.newPubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  p.nonce.copy(buf, offset, 0, 4); offset += 4;
  p.reserved.copy(buf, offset, 0, 2);
  
  return buf;
}

// AGENT_RETIRED (§5.4.15)
function encodeAgentRetired(p: AgentRetiredPayload): Buffer {
  const buf = Buffer.alloc(QP_PAYLOAD_SIZE);
  let offset = 0;
  
  p.pubkey.copy(buf, offset, 0, 33); offset += 33;
  buf.writeUInt32BE(p.timestamp, offset); offset += 4;
  buf.writeUInt8(p.reasonCode, offset); offset += 1;
  p.successor.copy(buf, offset, 0, 33); offset += 33;
  p.reserved.copy(buf, offset, 0, 5);
  
  return buf;
}

// ============================================
// Message Decoding
// ============================================

/**
 * Decode an 80-byte buffer to a QP message
 */
export function decodeMessage(buffer: Buffer): QPMessage {
  if (buffer.length !== QP_MESSAGE_SIZE) {
    throw new Error(`Invalid message size: ${buffer.length}, expected ${QP_MESSAGE_SIZE}`);
  }
  
  const magic = buffer.readUInt16BE(0);
  if (magic !== QP_MAGIC) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)}, expected 0x${QP_MAGIC.toString(16)}`);
  }
  
  const version = buffer.readUInt8(2);
  if (version !== QP_VERSION) {
    throw new Error(`Unsupported version: ${version}, expected ${QP_VERSION}`);
  }
  
  const type = buffer.readUInt8(3) as QPMessageType;
  const payloadBuf = buffer.subarray(4);
  const payload = decodePayload(type, payloadBuf);
  
  return { magic, version, type, payload };
}

function decodePayload(type: QPMessageType, buf: Buffer): QPPayload {
  switch (type) {
    case QPMessageType.SERVICE_ADVERTISE:
      return decodeServiceAdvertise(buf);
    case QPMessageType.SERVICE_REQUEST:
      return decodeServiceRequest(buf);
    case QPMessageType.HANDSHAKE_INIT:
      return decodeHandshakeInit(buf);
    case QPMessageType.HANDSHAKE_ACK:
      return decodeHandshakeAck(buf);
    case QPMessageType.DELIVERY_RECEIPT:
      return decodeDeliveryReceipt(buf);
    case QPMessageType.PAYMENT_COMPLETE:
      return decodePaymentComplete(buf);
    case QPMessageType.RATING:
      return decodeRating(buf);
    case QPMessageType.REVOKE_SERVICE:
      return decodeRevokeService(buf);
    case QPMessageType.PUBKEY_ANNOUNCE:
      return decodePubkeyAnnounce(buf);
    case QPMessageType.HTLC_OFFER:
      return decodeHtlcOffer(buf);
    case QPMessageType.HTLC_CLAIM:
      return decodeHtlcClaim(buf);
    case QPMessageType.CHANNEL_OPEN:
      return decodeChannelOpen(buf);
    case QPMessageType.CHANNEL_CLOSE:
      return decodeChannelClose(buf);
    case QPMessageType.KEY_ROTATION:
      return decodeKeyRotation(buf);
    case QPMessageType.AGENT_RETIRED:
      return decodeAgentRetired(buf);
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

function decodeServiceAdvertise(buf: Buffer): ServiceAdvertisePayload {
  let offset = 0;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const priceKoinu = buf.readUInt32BE(offset); offset += 4;
  const priceUnit = buf.readUInt8(offset) as PriceUnit; offset += 1;
  const flags = decodeAdvertiseFlags(buf.readUInt8(offset)); offset += 1;
  const ttlBlocks = buf.readUInt16BE(offset); offset += 2;
  const nonce = Buffer.from(buf.subarray(offset, offset + 4)); offset += 4;
  const pubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const metadataRaw = buf.subarray(offset, offset + 20);
  const metadata = metadataRaw.toString('utf8').replace(/\0+$/, '');
  
  return { skillCode, priceKoinu, priceUnit, flags, ttlBlocks, nonce, pubkey, metadata };
}

function decodeServiceRequest(buf: Buffer): ServiceRequestPayload {
  let offset = 0;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const budgetKoinu = buf.readUInt32BE(offset); offset += 4;
  const urgency = buf.readUInt8(offset); offset += 1;
  const sideloadPrefs = buf.readUInt8(offset); offset += 1;
  const nonce = Buffer.from(buf.subarray(offset, offset + 4)); offset += 4;
  const pubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const jobDescRaw = buf.subarray(offset, offset + 31);
  const jobDesc = jobDescRaw.toString('utf8').replace(/\0+$/, '');
  
  return { skillCode, budgetKoinu, urgency, sideloadPrefs, nonce, pubkey, jobDesc };
}

function decodeHandshakeInit(buf: Buffer): HandshakeInitPayload {
  let offset = 0;
  const ephemeralPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const nonce = Buffer.from(buf.subarray(offset, offset + 4)); offset += 4;
  const encryptedData = Buffer.from(buf.subarray(offset, offset + 35));
  
  return { ephemeralPubkey, timestamp, nonce, encryptedData };
}

function decodeHandshakeAck(buf: Buffer): HandshakeAckPayload {
  let offset = 0;
  const ephemeralPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const nonce = Buffer.from(buf.subarray(offset, offset + 4)); offset += 4;
  const encryptedData = Buffer.from(buf.subarray(offset, offset + 35));
  
  return { ephemeralPubkey, sessionId, nonce, encryptedData };
}

function decodeDeliveryReceipt(buf: Buffer): DeliveryReceiptPayload {
  let offset = 0;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const deliveryHash = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const sizeBytes = buf.readUInt32BE(offset); offset += 4;
  const ipfsCidHash = Buffer.from(buf.subarray(offset, offset + 30));
  
  return { sessionId, deliveryHash, timestamp, skillCode, sizeBytes, ipfsCidHash };
}

function decodePaymentComplete(buf: Buffer): PaymentCompletePayload {
  let offset = 0;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const deliveryHash = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const rating = buf.readUInt8(offset); offset += 1;
  const ratingFlags = decodeRatingFlags(buf.readUInt8(offset)); offset += 1;
  const tipKoinu = buf.readUInt32BE(offset); offset += 4;
  const reserved = Buffer.from(buf.subarray(offset, offset + 32));
  
  return { sessionId, deliveryHash, skillCode, rating, ratingFlags, tipKoinu, reserved };
}

function decodeRating(buf: Buffer): RatingPayload {
  let offset = 0;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const ratedAgent = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const rating = buf.readUInt8(offset); offset += 1;
  const flags = decodeRatingFlags(buf.readUInt8(offset)); offset += 1;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const paymentTxid = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const reserved = Buffer.from(buf.subarray(offset, offset + 3));
  
  return { sessionId, ratedAgent, rating, flags, skillCode, paymentTxid, reserved };
}

function decodeRevokeService(buf: Buffer): RevokeServicePayload {
  let offset = 0;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const adTxid = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const reserved = Buffer.from(buf.subarray(offset, offset + 38));
  
  return { skillCode, adTxid, timestamp, reserved };
}

function decodePubkeyAnnounce(buf: Buffer): PubkeyAnnouncePayload {
  let offset = 0;
  const pubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const agentType = buf.readUInt8(offset) as AgentType; offset += 1;
  const agentNameRaw = buf.subarray(offset, offset + 20);
  const agentName = agentNameRaw.toString('utf8').replace(/\0+$/, ''); offset += 20;
  const metadata = Buffer.from(buf.subarray(offset, offset + 18));
  
  return { pubkey, timestamp, agentType, agentName, metadata };
}

function decodeHtlcOffer(buf: Buffer): HtlcOfferPayload {
  let offset = 0;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const secretHash = Buffer.from(buf.subarray(offset, offset + 20)); offset += 20;
  const timeoutBlock = buf.readUInt32BE(offset); offset += 4;
  const toolPrice = buf.readUInt32BE(offset); offset += 4;
  const feeBuffer = buf.readUInt32BE(offset); offset += 4;
  const skillCode = buf.readUInt16BE(offset); offset += 2;
  const consumerPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const reserved = Buffer.from(buf.subarray(offset, offset + 5));
  
  return { sessionId, secretHash, timeoutBlock, toolPrice, feeBuffer, skillCode, consumerPubkey, reserved };
}

function decodeHtlcClaim(buf: Buffer): HtlcClaimPayload {
  let offset = 0;
  const sessionId = buf.readUInt32BE(offset); offset += 4;
  const fundingTxid = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const claimedKoinu = buf.readUInt32BE(offset); offset += 4;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const reserved = Buffer.from(buf.subarray(offset, offset + 32));
  
  return { sessionId, fundingTxid, claimedKoinu, timestamp, reserved };
}

function decodeChannelOpen(buf: Buffer): ChannelOpenPayload {
  let offset = 0;
  const channelId = buf.readUInt32BE(offset); offset += 4;
  const consumerPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const providerPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const ttlBlocks = buf.readUInt16BE(offset); offset += 2;
  const depositKoinu = buf.readUInt32BE(offset);
  
  return { channelId, consumerPubkey, providerPubkey, ttlBlocks, depositKoinu };
}

function decodeChannelClose(buf: Buffer): ChannelClosePayload {
  let offset = 0;
  const channelId = buf.readUInt32BE(offset); offset += 4;
  const fundingTxid = Buffer.from(buf.subarray(offset, offset + 32)); offset += 32;
  const consumerFinal = buf.readUInt32BE(offset); offset += 4;
  const providerFinal = buf.readUInt32BE(offset); offset += 4;
  const callCount = buf.readUInt32BE(offset); offset += 4;
  const closeType = buf.readUInt8(offset) as ChannelCloseType; offset += 1;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const reserved = Buffer.from(buf.subarray(offset, offset + 23));
  
  return { channelId, fundingTxid, consumerFinal, providerFinal, callCount, closeType, timestamp, reserved };
}

function decodeKeyRotation(buf: Buffer): KeyRotationPayload {
  let offset = 0;
  const oldPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const newPubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const nonce = Buffer.from(buf.subarray(offset, offset + 4)); offset += 4;
  const reserved = Buffer.from(buf.subarray(offset, offset + 2));
  
  return { oldPubkey, newPubkey, timestamp, nonce, reserved };
}

function decodeAgentRetired(buf: Buffer): AgentRetiredPayload {
  let offset = 0;
  const pubkey = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const timestamp = buf.readUInt32BE(offset); offset += 4;
  const reasonCode = buf.readUInt8(offset) as RetiredReason; offset += 1;
  const successor = Buffer.from(buf.subarray(offset, offset + 33)); offset += 33;
  const reserved = Buffer.from(buf.subarray(offset, offset + 5));
  
  return { pubkey, timestamp, reasonCode, successor, reserved };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Check if a buffer contains a valid QP message (by checking magic bytes)
 */
export function isQPMessage(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;
  return buffer.readUInt16BE(0) === QP_MAGIC;
}

/**
 * Get message type name for debugging
 */
export function getMessageTypeName(type: QPMessageType): string {
  return QPMessageType[type] || `UNKNOWN(0x${type.toString(16)})`;
}
