/**
 * Quackstro Protocol Types
 * Binary message types for A2A economy on Dogecoin
 */
export declare const QP_MAGIC = 20816;
export declare const QP_VERSION = 1;
export declare const QP_PAYLOAD_SIZE = 76;
export declare const QP_MESSAGE_SIZE = 80;
export declare enum QPMessageType {
    SERVICE_ADVERTISE = 1,
    SERVICE_REQUEST = 2,
    HANDSHAKE_INIT = 3,
    HANDSHAKE_ACK = 4,
    DELIVERY_RECEIPT = 5,
    PAYMENT_COMPLETE = 6,
    RATING = 7,
    REVOKE_SERVICE = 8,
    PUBKEY_ANNOUNCE = 9,
    HTLC_OFFER = 10,
    HTLC_CLAIM = 11,
    CHANNEL_OPEN = 12,
    CHANNEL_CLOSE = 13,
    KEY_ROTATION = 15,
    AGENT_RETIRED = 16
}
export declare enum PriceUnit {
    PER_REQUEST = 0,
    PER_KB = 1,
    PER_HOUR = 2,
    PER_1K_TOKENS = 3,
    FLAT_RATE = 4,
    NEGOTIABLE = 5
}
export interface AdvertiseFlags {
    supportsDirectHtlc: boolean;
    supportsSideloadHttps: boolean;
    supportsSideloadLibp2p: boolean;
    supportsSideloadIpfs: boolean;
    onlineNow: boolean;
    supportsPaymentChannel: boolean;
    acceptsPostPayment: boolean;
    isCompositeTool: boolean;
}
export interface RatingFlags {
    tipIncluded: boolean;
    dispute: boolean;
}
export declare enum ChannelCloseType {
    COOPERATIVE = 0,
    UNILATERAL_CONSUMER = 1,
    UNILATERAL_PROVIDER = 2,
    TIMEOUT = 3
}
export declare enum AgentType {
    PROVIDER = 0,
    CONSUMER = 1,
    BOTH = 2
}
export declare enum RetiredReason {
    UNSPECIFIED = 0,
    PLANNED = 1,
    COMPROMISED = 2,
    MIGRATING = 3
}
export declare enum SideloadProtocol {
    HTTPS = 0,
    LIBP2P = 1
}
export interface ServiceAdvertisePayload {
    skillCode: number;
    priceKoinu: number;
    priceUnit: PriceUnit;
    flags: AdvertiseFlags;
    ttlBlocks: number;
    nonce: Buffer;
    pubkey: Buffer;
    metadata: string;
}
export interface ServiceRequestPayload {
    skillCode: number;
    budgetKoinu: number;
    urgency: number;
    sideloadPrefs: number;
    nonce: Buffer;
    pubkey: Buffer;
    jobDesc: string;
}
export interface HandshakeInitPayload {
    ephemeralPubkey: Buffer;
    timestamp: number;
    nonce: Buffer;
    encryptedData: Buffer;
}
export interface HandshakeAckPayload {
    ephemeralPubkey: Buffer;
    sessionId: number;
    nonce: Buffer;
    encryptedData: Buffer;
}
export interface DeliveryReceiptPayload {
    sessionId: number;
    deliveryHash: Buffer;
    timestamp: number;
    skillCode: number;
    sizeBytes: number;
    ipfsCidHash: Buffer;
}
export interface PaymentCompletePayload {
    sessionId: number;
    deliveryHash: Buffer;
    skillCode: number;
    rating: number;
    ratingFlags: RatingFlags;
    tipKoinu: number;
    reserved: Buffer;
}
export interface RatingPayload {
    sessionId: number;
    ratedAgent: Buffer;
    rating: number;
    flags: RatingFlags;
    skillCode: number;
    paymentTxid: Buffer;
    reserved: Buffer;
}
export interface RevokeServicePayload {
    skillCode: number;
    adTxid: Buffer;
    timestamp: number;
    reserved: Buffer;
}
export interface PubkeyAnnouncePayload {
    pubkey: Buffer;
    timestamp: number;
    agentType: AgentType;
    agentName: string;
    metadata: Buffer;
}
export interface HtlcOfferPayload {
    sessionId: number;
    secretHash: Buffer;
    timeoutBlock: number;
    toolPrice: number;
    feeBuffer: number;
    skillCode: number;
    consumerPubkey: Buffer;
    reserved: Buffer;
}
export interface HtlcClaimPayload {
    sessionId: number;
    fundingTxid: Buffer;
    claimedKoinu: number;
    timestamp: number;
    reserved: Buffer;
}
export interface ChannelOpenPayload {
    channelId: number;
    consumerPubkey: Buffer;
    providerPubkey: Buffer;
    ttlBlocks: number;
    depositKoinu: number;
}
export interface ChannelClosePayload {
    channelId: number;
    fundingTxid: Buffer;
    consumerFinal: number;
    providerFinal: number;
    callCount: number;
    closeType: ChannelCloseType;
    timestamp: number;
    reserved: Buffer;
}
export interface KeyRotationPayload {
    oldPubkey: Buffer;
    newPubkey: Buffer;
    timestamp: number;
    nonce: Buffer;
    reserved: Buffer;
}
export interface AgentRetiredPayload {
    pubkey: Buffer;
    timestamp: number;
    reasonCode: RetiredReason;
    successor: Buffer;
    reserved: Buffer;
}
export type QPPayload = ServiceAdvertisePayload | ServiceRequestPayload | HandshakeInitPayload | HandshakeAckPayload | DeliveryReceiptPayload | PaymentCompletePayload | RatingPayload | RevokeServicePayload | PubkeyAnnouncePayload | HtlcOfferPayload | HtlcClaimPayload | ChannelOpenPayload | ChannelClosePayload | KeyRotationPayload | AgentRetiredPayload;
export interface QPMessage<T extends QPPayload = QPPayload> {
    magic: number;
    version: number;
    type: QPMessageType;
    payload: T;
}
export declare enum SkillCategory {
    RESERVED = 0,
    TEXT_LANGUAGE = 1,// 0x0100-0x01FF
    CODE_DEVELOPMENT = 2,// 0x0200-0x02FF
    DATA_ANALYTICS = 3,// 0x0300-0x03FF
    MEDIA = 4,// 0x0400-0x04FF
    RESEARCH = 5,// 0x0500-0x05FF
    INFRASTRUCTURE = 6,// 0x0600-0x06FF
    FINANCE = 7,// 0x0700-0x07FF
    SECURITY = 8,// 0x0800-0x08FF
    COMMUNICATION = 9,// 0x0900-0x09FF
    DOMAIN_SPECIFIC = 10,// 0x0A00-0x0AFF
    EXPERIMENTAL = 240
}
export declare const SkillCodes: {
    readonly ARBITER: 4;
    readonly TRANSLATION: 256;
    readonly SUMMARIZATION: 257;
    readonly WRITING: 258;
    readonly CODE_REVIEW: 512;
    readonly CODE_GENERATION: 513;
    readonly SCRAPING: 768;
    readonly ANALYSIS: 769;
    readonly IMAGE_GEN: 1024;
    readonly OCR: 1027;
    readonly ANY: 65535;
};
export declare const RegistryCategories: readonly ["general", "compute", "data", "content", "identity"];
export type RegistryCategory = typeof RegistryCategories[number];
//# sourceMappingURL=types.d.ts.map