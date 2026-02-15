/**
 * DOGE Wallet — P2P Protocol Message Serialization
 *
 * Implements the Bitcoin/Dogecoin P2P wire protocol for message framing,
 * version handshake, verack, and raw transaction relay.
 *
 * Reference: https://en.bitcoin.it/wiki/Protocol_documentation
 *
 * Much protocol. Very binary. Wow. 🐕
 */
/** P2P magic bytes per network */
export declare const MAGIC_BYTES: {
    readonly mainnet: 3233857728;
    readonly testnet: 3703030268;
};
/** Default P2P ports per network */
export declare const DEFAULT_PORT: {
    readonly mainnet: 22556;
    readonly testnet: 44556;
};
/** Protocol version to advertise (70015 = BIP-130+ compact blocks era) */
export declare const PROTOCOL_VERSION = 70015;
/** User agent we announce ourselves as */
export declare const USER_AGENT = "/OpenClawDoge:1.0.0/";
/** NODE_NETWORK service bit — we don't serve blocks, so claim 0 */
export declare const SERVICES: bigint;
/** Header size: magic(4) + command(12) + length(4) + checksum(4) */
export declare const HEADER_SIZE = 24;
/** Compute double-SHA256 of a buffer (standard Bitcoin hash) */
export declare function doubleSha256(data: Buffer): Buffer;
/**
 * Build a complete P2P message with header + payload.
 *
 * Format:
 *   [4] magic
 *   [12] command (null-padded ASCII)
 *   [4] payload length (LE)
 *   [4] checksum (first 4 bytes of dSHA256(payload))
 *   [n] payload
 */
export declare function buildMessage(command: string, payload: Buffer, network: "mainnet" | "testnet"): Buffer;
/**
 * Parse the command name from a raw message header.
 * Returns null if the buffer is too short or magic doesn't match.
 */
export declare function parseMessageHeader(data: Buffer, network: "mainnet" | "testnet"): {
    command: string;
    payloadLength: number;
} | null;
/** Encode a variable-length integer (CompactSize / varint) */
export declare function encodeVarInt(n: number): Buffer;
/** Encode a variable-length string (varint length prefix + bytes) */
export declare function encodeVarStr(str: string): Buffer;
/**
 * Serialize a network address for the version message.
 * Format: services(8) + IPv6-mapped-IPv4(16) + port(2 BE)
 */
export declare function serializeNetAddr(services: bigint, ip: string, port: number): Buffer;
/**
 * Build a `version` message payload.
 *
 * Fields:
 *   int32_t     version
 *   uint64_t    services
 *   int64_t     timestamp
 *   net_addr    addr_recv  (26 bytes, no timestamp prefix in version msg)
 *   net_addr    addr_from  (26 bytes)
 *   uint64_t    nonce
 *   var_str     user_agent
 *   int32_t     start_height
 *   bool        relay
 */
export declare function buildVersionPayload(peerIp: string, peerPort: number, startHeight?: number): Buffer;
/** Build a `verack` message (empty payload) */
export declare function buildVerackMessage(network: "mainnet" | "testnet"): Buffer;
/**
 * Build a `tx` message from a signed transaction hex string.
 * The payload is simply the raw transaction bytes.
 */
export declare function buildTxMessage(signedTxHex: string, network: "mainnet" | "testnet"): Buffer;
//# sourceMappingURL=protocol.d.ts.map