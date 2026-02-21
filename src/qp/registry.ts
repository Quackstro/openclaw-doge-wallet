/**
 * Quackstro Protocol Registry Operations
 * Registry address generation and service advertisement
 */

import { createHash } from 'crypto';
import bs58check from 'bs58check';
import { hash160, sha256 } from './crypto.js';
import type { RegistryCategory } from './types.js';

// Dogecoin address version bytes
const DOGE_P2PKH_VERSION = 0x1e; // Mainnet P2PKH (starts with 'D')
const DOGE_P2SH_VERSION = 0x16;  // Mainnet P2SH (starts with '9' or 'A')

// Pre-computed registry addresses (verified against spec §6.1)
export const REGISTRY_ADDRESSES: Record<RegistryCategory, string> = {
  general: 'DG7EBGqYFaWnaYeH9QQNEWeT6xY2DqVCzE',
  compute: 'DMiK6hDKciWj4NG9Pi7m9dtATduM46sdsT',
  data: 'D9mT3x5tsg7UYtxvjs9YwN8HN6EPiroSF6',
  content: 'DFhMUCFGhiv7Fd5fA1nvceDwTzPW8zpMi8',
  identity: 'DLtg8eRLc4BCZsb18GAvYmDRZC1PDyyJSi',
};

/**
 * Generate a registry address from a category name
 * Formula: Base58Check(0x1e || RIPEMD160(SHA256("QuackstroProtocol:Registry:v1:<category>")))
 * 
 * Note: This follows the spec §6.1 example code which does SHA256 → RIPEMD160
 */
export function generateRegistryAddress(category: string): string {
  const input = `QuackstroProtocol:Registry:v1:${category}`;
  const inputBuffer = Buffer.from(input, 'utf8');
  
  // SHA256 of the input string
  const sha256Hash = sha256(inputBuffer);
  
  // RIPEMD160 of the SHA256 hash
  const ripemdHash = createHash('ripemd160').update(sha256Hash).digest();
  
  // Create P2PKH payload: version byte + 20-byte hash
  const payload = Buffer.alloc(21);
  payload[0] = DOGE_P2PKH_VERSION;
  ripemdHash.copy(payload, 1);
  
  return bs58check.encode(payload);
}

/**
 * Verify that our generation matches the expected addresses
 */
export function verifyRegistryAddresses(): boolean {
  for (const [category, expected] of Object.entries(REGISTRY_ADDRESSES)) {
    const generated = generateRegistryAddress(category);
    if (generated !== expected) {
      console.error(`Registry address mismatch for ${category}: got ${generated}, expected ${expected}`);
      return false;
    }
  }
  return true;
}

/**
 * Get the registry address for a category
 */
export function getRegistryAddress(category: RegistryCategory): string {
  return REGISTRY_ADDRESSES[category];
}

/**
 * Check if an address is a known registry address
 */
export function isRegistryAddress(address: string): RegistryCategory | null {
  for (const [category, addr] of Object.entries(REGISTRY_ADDRESSES)) {
    if (addr === address) {
      return category as RegistryCategory;
    }
  }
  return null;
}

/**
 * Decode a Dogecoin address to get the hash and version
 */
export function decodeAddress(address: string): { version: number; hash: Buffer } {
  const decoded = bs58check.decode(address);
  return {
    version: decoded[0],
    hash: Buffer.from(decoded.subarray(1)),
  };
}

/**
 * Encode a hash to a Dogecoin P2PKH address
 */
export function encodeP2PKHAddress(hash: Buffer): string {
  if (hash.length !== 20) {
    throw new Error('Hash must be 20 bytes');
  }
  const payload = Buffer.alloc(21);
  payload[0] = DOGE_P2PKH_VERSION;
  hash.copy(payload, 1);
  return bs58check.encode(payload);
}

/**
 * Encode a script hash to a Dogecoin P2SH address
 */
export function encodeP2SHAddress(scriptHash: Buffer): string {
  if (scriptHash.length !== 20) {
    throw new Error('Script hash must be 20 bytes');
  }
  const payload = Buffer.alloc(21);
  payload[0] = DOGE_P2SH_VERSION;
  scriptHash.copy(payload, 1);
  return bs58check.encode(payload);
}

/**
 * Get address from compressed public key
 */
export function pubkeyToAddress(pubkey: Buffer): string {
  if (pubkey.length !== 33 && pubkey.length !== 65) {
    throw new Error('Public key must be 33 (compressed) or 65 (uncompressed) bytes');
  }
  const pubkeyHash = hash160(pubkey);
  return encodeP2PKHAddress(pubkeyHash);
}
