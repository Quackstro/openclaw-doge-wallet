/**
 * DOGE Wallet — Key Derivation & Address Utilities
 *
 * BIP44 key derivation (m/44'/3'/0'/0/0) and address validation.
 * Uses hdkey for BIP32 derivation and Node.js crypto for hashing.
 *
 * Much derive. Very BIP44. Wow. 🐕
 */
import { type KeyPair } from "../types.js";
/**
 * Derive a DOGE address from a compressed public key.
 */
export declare function publicKeyToAddress(publicKey: Buffer, network: "mainnet" | "testnet"): string;
/**
 * Derive a BIP44 key pair from a BIP39 seed.
 *
 * Path: m/44'/3'/0'/0/0 (Dogecoin BIP44)
 *
 * @param seed - BIP39 seed buffer (64 bytes from mnemonic)
 * @param network - "mainnet" or "testnet"
 * @returns KeyPair with private key, public key, address, and derivation path
 */
export declare function deriveKeyPair(seed: Buffer, network: "mainnet" | "testnet"): KeyPair;
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
export declare function isValidAddress(address: string, network: "mainnet" | "testnet"): boolean;
//# sourceMappingURL=derivation.d.ts.map