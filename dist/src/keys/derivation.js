/**
 * DOGE Wallet — Key Derivation & Address Utilities
 *
 * BIP44 key derivation (m/44'/3'/0'/0/0) and address validation.
 * Uses hdkey for BIP32 derivation and Node.js crypto for hashing.
 *
 * Much derive. Very BIP44. Wow. 🐕
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import HDKey from "hdkey";
import { DOGE_MAINNET, DOGE_TESTNET, } from "../types.js";
const require = createRequire(import.meta.url);
// BIP44 coin type for Dogecoin
const DOGE_COIN_TYPE = 3;
// BIP44 derivation path: m/44'/3'/0'/0/0
const BIP44_PATH = `m/44'/${DOGE_COIN_TYPE}'/0'/0/0`;
/**
 * Get network parameters for the given network name.
 */
function getNetworkParams(network) {
    return network === "testnet" ? DOGE_TESTNET : DOGE_MAINNET;
}
/**
 * Compute RIPEMD160(SHA256(data)) — standard Bitcoin/DOGE hash160.
 */
function hash160(data) {
    const sha = createHash("sha256").update(data).digest();
    return createHash("ripemd160").update(sha).digest();
}
/**
 * Encode a pubKeyHash into a DOGE address using Base58Check.
 *
 * Format: Base58Check(versionByte + pubKeyHash)
 */
function encodeAddress(pubKeyHash, versionByte) {
    // bs58check is a transitive dependency of hdkey
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs58check = require("bs58check");
    const payload = Buffer.alloc(1 + pubKeyHash.length);
    payload[0] = versionByte;
    pubKeyHash.copy(payload, 1);
    return bs58check.encode(payload);
}
/**
 * Derive a DOGE address from a compressed public key.
 */
export function publicKeyToAddress(publicKey, network) {
    const params = getNetworkParams(network);
    const pkHash = hash160(publicKey);
    return encodeAddress(pkHash, params.pubKeyHash);
}
/**
 * Derive a BIP44 key pair from a BIP39 seed.
 *
 * Path: m/44'/3'/0'/0/0 (Dogecoin BIP44)
 *
 * @param seed - BIP39 seed buffer (64 bytes from mnemonic)
 * @param network - "mainnet" or "testnet"
 * @returns KeyPair with private key, public key, address, and derivation path
 */
export function deriveKeyPair(seed, network) {
    const params = getNetworkParams(network);
    // Create master HD key from seed with DOGE-specific version bytes
    const master = HDKey.fromMasterSeed(seed, {
        private: params.bip32.private,
        public: params.bip32.public,
    });
    // Derive the BIP44 child key
    const child = master.derive(BIP44_PATH);
    if (!child.privateKey || !child.publicKey) {
        throw new Error("Key derivation failed — no private/public key produced");
    }
    const privateKey = Buffer.from(child.privateKey);
    const publicKey = Buffer.from(child.publicKey);
    const address = publicKeyToAddress(publicKey, network);
    return {
        privateKey,
        publicKey: publicKey.toString("hex"),
        address,
        derivationPath: BIP44_PATH,
        index: 0,
    };
}
/**
 * Validate a DOGE address.
 *
 * Checks:
 * 1. Base58Check decoding succeeds (valid checksum)
 * 2. Version byte matches the expected network (mainnet or testnet)
 * 3. Payload is 21 bytes (1 version + 20 pubKeyHash)
 *
 * @param address - Address string to validate
 * @param network - "mainnet" or "testnet"
 * @returns true if the address is valid for the given network
 */
export function isValidAddress(address, network) {
    if (!address || typeof address !== "string")
        return false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const bs58check = require("bs58check");
        const decoded = bs58check.decode(address);
        // Must be exactly 21 bytes (1 version + 20 hash)
        if (decoded.length !== 21)
            return false;
        const versionByte = decoded[0];
        const params = getNetworkParams(network);
        // Accept both P2PKH and P2SH addresses
        return (versionByte === params.pubKeyHash || versionByte === params.scriptHash);
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=derivation.js.map