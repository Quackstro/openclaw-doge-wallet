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

import { createHash } from "node:crypto";

// ============================================================================
// Constants
// ============================================================================

/** P2P magic bytes per network */
export const MAGIC_BYTES = {
  mainnet: 0xc0c0c0c0,
  testnet: 0xdcb7c1fc,
} as const;

/** Default P2P ports per network */
export const DEFAULT_PORT = {
  mainnet: 22556,
  testnet: 44556,
} as const;

/** Protocol version to advertise (70015 = BIP-130+ compact blocks era) */
export const PROTOCOL_VERSION = 70015;

/** User agent we announce ourselves as */
export const USER_AGENT = "/OpenClawDoge:0.1.0/";

/** NODE_NETWORK service bit — we don't serve blocks, so claim 0 */
export const SERVICES = BigInt(0);

/** Header size: magic(4) + command(12) + length(4) + checksum(4) */
export const HEADER_SIZE = 24;

// ============================================================================
// Double-SHA256
// ============================================================================

/** Compute double-SHA256 of a buffer (standard Bitcoin hash) */
export function doubleSha256(data: Buffer): Buffer {
  const first = createHash("sha256").update(data).digest();
  return createHash("sha256").update(first).digest();
}

// ============================================================================
// Message Framing
// ============================================================================

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
export function buildMessage(
  command: string,
  payload: Buffer,
  network: "mainnet" | "testnet",
): Buffer {
  const magic = MAGIC_BYTES[network];

  // Header
  const header = Buffer.alloc(HEADER_SIZE);

  // Magic (4 bytes LE)
  header.writeUInt32LE(magic, 0);

  // Command (12 bytes, null-padded)
  const cmdBuf = Buffer.alloc(12, 0);
  Buffer.from(command, "ascii").copy(cmdBuf);
  cmdBuf.copy(header, 4);

  // Payload length (4 bytes LE)
  header.writeUInt32LE(payload.length, 16);

  // Checksum (first 4 bytes of double-SHA256 of payload)
  const checksum = doubleSha256(payload).subarray(0, 4);
  checksum.copy(header, 20);

  return Buffer.concat([header, payload]);
}

/**
 * Parse the command name from a raw message header.
 * Returns null if the buffer is too short or magic doesn't match.
 */
export function parseMessageHeader(
  data: Buffer,
  network: "mainnet" | "testnet",
): { command: string; payloadLength: number } | null {
  if (data.length < HEADER_SIZE) return null;

  const magic = data.readUInt32LE(0);
  if (magic !== MAGIC_BYTES[network]) return null;

  // Command: 12 bytes, trim trailing nulls
  const cmdRaw = data.subarray(4, 16);
  const nullIdx = cmdRaw.indexOf(0);
  const command = cmdRaw.subarray(0, nullIdx === -1 ? 12 : nullIdx).toString("ascii");

  const payloadLength = data.readUInt32LE(16);

  return { command, payloadLength };
}

// ============================================================================
// Variable-length integer (CompactSize)
// ============================================================================

/** Encode a variable-length integer (CompactSize / varint) */
export function encodeVarInt(n: number): Buffer {
  if (n < 0xfd) {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(n, 0);
    return buf;
  } else if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf.writeUInt8(0xfd, 0);
    buf.writeUInt16LE(n, 1);
    return buf;
  } else if (n <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf.writeUInt8(0xfe, 0);
    buf.writeUInt32LE(n, 1);
    return buf;
  } else {
    const buf = Buffer.alloc(9);
    buf.writeUInt8(0xff, 0);
    buf.writeBigUInt64LE(BigInt(n), 1);
    return buf;
  }
}

/** Encode a variable-length string (varint length prefix + bytes) */
export function encodeVarStr(str: string): Buffer {
  const strBuf = Buffer.from(str, "utf8");
  return Buffer.concat([encodeVarInt(strBuf.length), strBuf]);
}

// ============================================================================
// Network Address Serialization
// ============================================================================

/**
 * Serialize a network address for the version message.
 * Format: services(8) + IPv6-mapped-IPv4(16) + port(2 BE)
 */
export function serializeNetAddr(services: bigint, ip: string, port: number): Buffer {
  const buf = Buffer.alloc(26);

  // Services (8 bytes LE)
  buf.writeBigUInt64LE(services, 0);

  // IPv6-mapped IPv4 address (16 bytes)
  // ::ffff:a.b.c.d
  buf.fill(0, 8, 20);
  buf.writeUInt16BE(0xffff, 18);
  const parts = ip.split(".").map(Number);
  if (parts.length === 4) {
    buf[20] = parts[0];
    buf[21] = parts[1];
    buf[22] = parts[2];
    buf[23] = parts[3];
  }

  // Port (2 bytes BE — network byte order)
  buf.writeUInt16BE(port, 24);

  return buf;
}

// ============================================================================
// Version Message
// ============================================================================

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
export function buildVersionPayload(
  peerIp: string,
  peerPort: number,
  startHeight: number = 0,
): Buffer {
  const parts: Buffer[] = [];

  // Protocol version (4 bytes LE)
  const versionBuf = Buffer.alloc(4);
  versionBuf.writeInt32LE(PROTOCOL_VERSION, 0);
  parts.push(versionBuf);

  // Services (8 bytes LE)
  const servicesBuf = Buffer.alloc(8);
  servicesBuf.writeBigUInt64LE(SERVICES, 0);
  parts.push(servicesBuf);

  // Timestamp (8 bytes LE — seconds since epoch)
  const timestampBuf = Buffer.alloc(8);
  timestampBuf.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 0);
  parts.push(timestampBuf);

  // addr_recv — the peer's address
  parts.push(serializeNetAddr(BigInt(1), peerIp, peerPort));

  // addr_from — our address (0.0.0.0:0)
  parts.push(serializeNetAddr(SERVICES, "0.0.0.0", 0));

  // Nonce (8 bytes — random to detect self-connections)
  const nonceBuf = Buffer.alloc(8);
  const nonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  nonceBuf.writeBigUInt64LE(nonce, 0);
  parts.push(nonceBuf);

  // User agent (var_str)
  parts.push(encodeVarStr(USER_AGENT));

  // Start height (4 bytes LE)
  const heightBuf = Buffer.alloc(4);
  heightBuf.writeInt32LE(startHeight, 0);
  parts.push(heightBuf);

  // Relay (1 byte — we want tx relay)
  const relayBuf = Buffer.alloc(1);
  relayBuf.writeUInt8(1, 0);
  parts.push(relayBuf);

  return Buffer.concat(parts);
}

// ============================================================================
// Verack Message
// ============================================================================

/** Build a `verack` message (empty payload) */
export function buildVerackMessage(network: "mainnet" | "testnet"): Buffer {
  return buildMessage("verack", Buffer.alloc(0), network);
}

// ============================================================================
// TX Message
// ============================================================================

/**
 * Build a `tx` message from a signed transaction hex string.
 * The payload is simply the raw transaction bytes.
 */
export function buildTxMessage(signedTxHex: string, network: "mainnet" | "testnet"): Buffer {
  const txPayload = Buffer.from(signedTxHex, "hex");
  return buildMessage("tx", txPayload, network);
}
