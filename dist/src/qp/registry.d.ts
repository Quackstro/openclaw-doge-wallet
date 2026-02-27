/**
 * Quackstro Protocol Registry Operations
 * Registry address generation and service advertisement
 */
import type { RegistryCategory } from './types.js';
export declare const REGISTRY_ADDRESSES: Record<RegistryCategory, string>;
/**
 * Generate a registry address from a category name
 * Formula: Base58Check(0x1e || RIPEMD160(SHA256("QuackstroProtocol:Registry:v1:<category>")))
 *
 * Note: This follows the spec §6.1 example code which does SHA256 → RIPEMD160
 */
export declare function generateRegistryAddress(category: string): string;
/**
 * Verify that our generation matches the expected addresses
 */
export declare function verifyRegistryAddresses(): boolean;
/**
 * Get the registry address for a category
 */
export declare function getRegistryAddress(category: RegistryCategory): string;
/**
 * Check if an address is a known registry address
 */
export declare function isRegistryAddress(address: string): RegistryCategory | null;
/**
 * Decode a Dogecoin address to get the hash and version
 */
export declare function decodeAddress(address: string): {
    version: number;
    hash: Buffer;
};
/**
 * Encode a hash to a Dogecoin P2PKH address
 */
export declare function encodeP2PKHAddress(hash: Buffer): string;
/**
 * Encode a script hash to a Dogecoin P2SH address
 */
export declare function encodeP2SHAddress(scriptHash: Buffer): string;
/**
 * Get address from compressed public key
 */
export declare function pubkeyToAddress(pubkey: Buffer): string;
//# sourceMappingURL=registry.d.ts.map