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
export var QPMessageType;
(function (QPMessageType) {
    QPMessageType[QPMessageType["SERVICE_ADVERTISE"] = 1] = "SERVICE_ADVERTISE";
    QPMessageType[QPMessageType["SERVICE_REQUEST"] = 2] = "SERVICE_REQUEST";
    QPMessageType[QPMessageType["HANDSHAKE_INIT"] = 3] = "HANDSHAKE_INIT";
    QPMessageType[QPMessageType["HANDSHAKE_ACK"] = 4] = "HANDSHAKE_ACK";
    QPMessageType[QPMessageType["DELIVERY_RECEIPT"] = 5] = "DELIVERY_RECEIPT";
    QPMessageType[QPMessageType["PAYMENT_COMPLETE"] = 6] = "PAYMENT_COMPLETE";
    QPMessageType[QPMessageType["RATING"] = 7] = "RATING";
    QPMessageType[QPMessageType["REVOKE_SERVICE"] = 8] = "REVOKE_SERVICE";
    QPMessageType[QPMessageType["PUBKEY_ANNOUNCE"] = 9] = "PUBKEY_ANNOUNCE";
    QPMessageType[QPMessageType["HTLC_OFFER"] = 10] = "HTLC_OFFER";
    QPMessageType[QPMessageType["HTLC_CLAIM"] = 11] = "HTLC_CLAIM";
    QPMessageType[QPMessageType["CHANNEL_OPEN"] = 12] = "CHANNEL_OPEN";
    QPMessageType[QPMessageType["CHANNEL_CLOSE"] = 13] = "CHANNEL_CLOSE";
    // 0x0E reserved
    QPMessageType[QPMessageType["KEY_ROTATION"] = 15] = "KEY_ROTATION";
    QPMessageType[QPMessageType["AGENT_RETIRED"] = 16] = "AGENT_RETIRED";
})(QPMessageType || (QPMessageType = {}));
// Price units (§5.4.1)
export var PriceUnit;
(function (PriceUnit) {
    PriceUnit[PriceUnit["PER_REQUEST"] = 0] = "PER_REQUEST";
    PriceUnit[PriceUnit["PER_KB"] = 1] = "PER_KB";
    PriceUnit[PriceUnit["PER_HOUR"] = 2] = "PER_HOUR";
    PriceUnit[PriceUnit["PER_1K_TOKENS"] = 3] = "PER_1K_TOKENS";
    PriceUnit[PriceUnit["FLAT_RATE"] = 4] = "FLAT_RATE";
    PriceUnit[PriceUnit["NEGOTIABLE"] = 5] = "NEGOTIABLE";
})(PriceUnit || (PriceUnit = {}));
// Channel close types (§5.4.13)
export var ChannelCloseType;
(function (ChannelCloseType) {
    ChannelCloseType[ChannelCloseType["COOPERATIVE"] = 0] = "COOPERATIVE";
    ChannelCloseType[ChannelCloseType["UNILATERAL_CONSUMER"] = 1] = "UNILATERAL_CONSUMER";
    ChannelCloseType[ChannelCloseType["UNILATERAL_PROVIDER"] = 2] = "UNILATERAL_PROVIDER";
    ChannelCloseType[ChannelCloseType["TIMEOUT"] = 3] = "TIMEOUT";
})(ChannelCloseType || (ChannelCloseType = {}));
// Agent types (§5.4.9)
export var AgentType;
(function (AgentType) {
    AgentType[AgentType["PROVIDER"] = 0] = "PROVIDER";
    AgentType[AgentType["CONSUMER"] = 1] = "CONSUMER";
    AgentType[AgentType["BOTH"] = 2] = "BOTH";
})(AgentType || (AgentType = {}));
// Agent retired reason codes (§5.4.15)
export var RetiredReason;
(function (RetiredReason) {
    RetiredReason[RetiredReason["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    RetiredReason[RetiredReason["PLANNED"] = 1] = "PLANNED";
    RetiredReason[RetiredReason["COMPROMISED"] = 2] = "COMPROMISED";
    RetiredReason[RetiredReason["MIGRATING"] = 3] = "MIGRATING";
})(RetiredReason || (RetiredReason = {}));
// Sideload protocol types
export var SideloadProtocol;
(function (SideloadProtocol) {
    SideloadProtocol[SideloadProtocol["HTTPS"] = 0] = "HTTPS";
    SideloadProtocol[SideloadProtocol["LIBP2P"] = 1] = "LIBP2P";
})(SideloadProtocol || (SideloadProtocol = {}));
// ============================================
// Skill Codes (§13)
// ============================================
export var SkillCategory;
(function (SkillCategory) {
    SkillCategory[SkillCategory["RESERVED"] = 0] = "RESERVED";
    SkillCategory[SkillCategory["TEXT_LANGUAGE"] = 1] = "TEXT_LANGUAGE";
    SkillCategory[SkillCategory["CODE_DEVELOPMENT"] = 2] = "CODE_DEVELOPMENT";
    SkillCategory[SkillCategory["DATA_ANALYTICS"] = 3] = "DATA_ANALYTICS";
    SkillCategory[SkillCategory["MEDIA"] = 4] = "MEDIA";
    SkillCategory[SkillCategory["RESEARCH"] = 5] = "RESEARCH";
    SkillCategory[SkillCategory["INFRASTRUCTURE"] = 6] = "INFRASTRUCTURE";
    SkillCategory[SkillCategory["FINANCE"] = 7] = "FINANCE";
    SkillCategory[SkillCategory["SECURITY"] = 8] = "SECURITY";
    SkillCategory[SkillCategory["COMMUNICATION"] = 9] = "COMMUNICATION";
    SkillCategory[SkillCategory["DOMAIN_SPECIFIC"] = 10] = "DOMAIN_SPECIFIC";
    SkillCategory[SkillCategory["EXPERIMENTAL"] = 240] = "EXPERIMENTAL";
})(SkillCategory || (SkillCategory = {}));
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
};
// Registry categories
export const RegistryCategories = ['general', 'compute', 'data', 'content', 'identity'];
//# sourceMappingURL=types.js.map