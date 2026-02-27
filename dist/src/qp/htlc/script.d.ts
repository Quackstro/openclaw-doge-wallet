/**
 * HTLC Script Builder
 * Bitcoin Script for Hash Time-Locked Contracts
 */
import type { HTLCParams, HTLCDetails } from './types.js';
/**
 * Build an HTLC redeem script
 *
 * Script structure (from spec §9.1):
 * ```
 * OP_IF
 *   // Provider claim path — knows the preimage
 *   OP_HASH160 <hash_160_of_secret> OP_EQUALVERIFY
 *   <provider_pubkey> OP_CHECKSIG
 * OP_ELSE
 *   // Consumer refund path — after timeout
 *   <timeout_block_height> OP_CHECKLOCKTIMEVERIFY OP_DROP
 *   <consumer_pubkey> OP_CHECKSIG
 * OP_ENDIF
 * ```
 *
 * Total size: 103 bytes
 */
export declare function buildRedeemScript(params: HTLCParams): Buffer;
/**
 * Create an HTLC with P2SH address
 */
export declare function createHTLC(params: HTLCParams): HTLCDetails;
/**
 * Build scriptSig for provider to claim HTLC
 *
 * Stack after scriptSig:
 *   <signature> <secret> OP_TRUE <redeemScript>
 */
export declare function buildClaimScriptSig(signature: Buffer, secret: Buffer, redeemScript: Buffer): Buffer;
/**
 * Build scriptSig for consumer to refund HTLC after timeout
 *
 * Stack after scriptSig:
 *   <signature> OP_FALSE <redeemScript>
 */
export declare function buildRefundScriptSig(signature: Buffer, redeemScript: Buffer): Buffer;
/**
 * Parse an HTLC redeem script to extract parameters
 */
export declare function parseRedeemScript(script: Buffer): HTLCParams;
/**
 * Verify a secret matches a hash
 */
export declare function verifySecret(secret: Buffer, expectedHash: Buffer): boolean;
/**
 * Generate a random secret
 */
export declare function generateSecret(): Buffer;
/**
 * Compute HASH160 of a secret
 */
export declare function hashSecret(secret: Buffer): Buffer;
//# sourceMappingURL=script.d.ts.map