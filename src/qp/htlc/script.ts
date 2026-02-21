/**
 * HTLC Script Builder
 * Bitcoin Script for Hash Time-Locked Contracts
 */

import { hash160 } from '../crypto.js';
import { encodeP2SHAddress } from '../registry.js';
import type { HTLCParams, HTLCDetails } from './types.js';
import { HTLC_DEFAULTS } from './types.js';

// Bitcoin Script opcodes
const OP = {
  FALSE: 0x00,
  TRUE: 0x51,
  IF: 0x63,
  ELSE: 0x67,
  ENDIF: 0x68,
  DROP: 0x75,
  DUP: 0x76,
  EQUALVERIFY: 0x88,
  CHECKSIG: 0xac,
  HASH160: 0xa9,
  CHECKLOCKTIMEVERIFY: 0xb1,
  // Push opcodes
  PUSHDATA1: 0x4c,
} as const;

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
export function buildRedeemScript(params: HTLCParams): Buffer {
  const { secretHash, providerPubkey, consumerPubkey, timeoutBlock } = params;

  // Validate inputs
  if (secretHash.length !== HTLC_DEFAULTS.HASH_SIZE) {
    throw new Error(`Secret hash must be ${HTLC_DEFAULTS.HASH_SIZE} bytes, got ${secretHash.length}`);
  }
  if (providerPubkey.length !== 33) {
    throw new Error(`Provider pubkey must be 33 bytes (compressed), got ${providerPubkey.length}`);
  }
  if (consumerPubkey.length !== 33) {
    throw new Error(`Consumer pubkey must be 33 bytes (compressed), got ${consumerPubkey.length}`);
  }
  if (timeoutBlock <= 0 || timeoutBlock > 0xFFFFFFFF) {
    throw new Error(`Timeout block must be positive uint32, got ${timeoutBlock}`);
  }

  // Encode timeout as 4-byte little-endian (Bitcoin uses LE for script numbers)
  const timeoutBuf = Buffer.alloc(4);
  timeoutBuf.writeUInt32LE(timeoutBlock);

  // Build the script
  const script = Buffer.concat([
    // OP_IF
    Buffer.from([OP.IF]),
    
    // Provider claim path
    Buffer.from([OP.HASH160]),
    Buffer.from([0x14]),              // Push 20 bytes
    secretHash,                        // 20 bytes
    Buffer.from([OP.EQUALVERIFY]),
    Buffer.from([0x21]),              // Push 33 bytes
    providerPubkey,                    // 33 bytes
    Buffer.from([OP.CHECKSIG]),
    
    // OP_ELSE
    Buffer.from([OP.ELSE]),
    
    // Consumer refund path
    Buffer.from([0x04]),              // Push 4 bytes
    timeoutBuf,                        // 4 bytes (LE)
    Buffer.from([OP.CHECKLOCKTIMEVERIFY]),
    Buffer.from([OP.DROP]),
    Buffer.from([0x21]),              // Push 33 bytes
    consumerPubkey,                    // 33 bytes
    Buffer.from([OP.CHECKSIG]),
    
    // OP_ENDIF
    Buffer.from([OP.ENDIF]),
  ]);

  // Verify expected size (103 bytes)
  if (script.length !== 103) {
    throw new Error(`Unexpected script size: ${script.length}, expected 103`);
  }

  return script;
}

/**
 * Create an HTLC with P2SH address
 */
export function createHTLC(params: HTLCParams): HTLCDetails {
  const redeemScript = buildRedeemScript(params);
  const scriptHash = hash160(redeemScript);
  const p2shAddress = encodeP2SHAddress(scriptHash);

  return {
    ...params,
    redeemScript,
    scriptHash,
    p2shAddress,
  };
}

/**
 * Build scriptSig for provider to claim HTLC
 * 
 * Stack after scriptSig:
 *   <signature> <secret> OP_TRUE <redeemScript>
 */
export function buildClaimScriptSig(
  signature: Buffer,
  secret: Buffer,
  redeemScript: Buffer
): Buffer {
  if (secret.length !== HTLC_DEFAULTS.SECRET_SIZE) {
    throw new Error(`Secret must be ${HTLC_DEFAULTS.SECRET_SIZE} bytes, got ${secret.length}`);
  }

  // Build scriptSig
  const parts: Buffer[] = [];

  // Push signature (DER-encoded, variable length)
  if (signature.length <= 75) {
    parts.push(Buffer.from([signature.length]));
  } else {
    parts.push(Buffer.from([OP.PUSHDATA1, signature.length]));
  }
  parts.push(signature);

  // Push secret (32 bytes)
  parts.push(Buffer.from([0x20])); // Push 32 bytes
  parts.push(secret);

  // OP_TRUE to select IF branch
  parts.push(Buffer.from([OP.TRUE]));

  // Push redeem script
  if (redeemScript.length <= 75) {
    parts.push(Buffer.from([redeemScript.length]));
  } else if (redeemScript.length <= 255) {
    parts.push(Buffer.from([OP.PUSHDATA1, redeemScript.length]));
  } else {
    throw new Error('Redeem script too large');
  }
  parts.push(redeemScript);

  return Buffer.concat(parts);
}

/**
 * Build scriptSig for consumer to refund HTLC after timeout
 * 
 * Stack after scriptSig:
 *   <signature> OP_FALSE <redeemScript>
 */
export function buildRefundScriptSig(
  signature: Buffer,
  redeemScript: Buffer
): Buffer {
  const parts: Buffer[] = [];

  // Push signature
  if (signature.length <= 75) {
    parts.push(Buffer.from([signature.length]));
  } else {
    parts.push(Buffer.from([OP.PUSHDATA1, signature.length]));
  }
  parts.push(signature);

  // OP_FALSE to select ELSE branch
  parts.push(Buffer.from([OP.FALSE]));

  // Push redeem script
  if (redeemScript.length <= 75) {
    parts.push(Buffer.from([redeemScript.length]));
  } else if (redeemScript.length <= 255) {
    parts.push(Buffer.from([OP.PUSHDATA1, redeemScript.length]));
  } else {
    throw new Error('Redeem script too large');
  }
  parts.push(redeemScript);

  return Buffer.concat(parts);
}

/**
 * Parse an HTLC redeem script to extract parameters
 */
export function parseRedeemScript(script: Buffer): HTLCParams {
  if (script.length !== 103) {
    throw new Error(`Invalid script length: ${script.length}, expected 103`);
  }

  // Verify structure
  if (script[0] !== OP.IF) {
    throw new Error('Script must start with OP_IF');
  }
  if (script[1] !== OP.HASH160) {
    throw new Error('Expected OP_HASH160 after OP_IF');
  }
  if (script[2] !== 0x14) {
    throw new Error('Expected PUSH20 for secret hash');
  }

  // Extract secret hash (bytes 3-22)
  const secretHash = Buffer.from(script.subarray(3, 23));

  // Verify OP_EQUALVERIFY at byte 23
  if (script[23] !== OP.EQUALVERIFY) {
    throw new Error('Expected OP_EQUALVERIFY after secret hash');
  }

  // Verify PUSH33 at byte 24
  if (script[24] !== 0x21) {
    throw new Error('Expected PUSH33 for provider pubkey');
  }

  // Extract provider pubkey (bytes 25-57)
  const providerPubkey = Buffer.from(script.subarray(25, 58));

  // Verify OP_CHECKSIG at byte 58
  if (script[58] !== OP.CHECKSIG) {
    throw new Error('Expected OP_CHECKSIG after provider pubkey');
  }

  // Verify OP_ELSE at byte 59
  if (script[59] !== OP.ELSE) {
    throw new Error('Expected OP_ELSE');
  }

  // Verify PUSH4 at byte 60
  if (script[60] !== 0x04) {
    throw new Error('Expected PUSH4 for timeout block');
  }

  // Extract timeout block (bytes 61-64, little-endian)
  const timeoutBlock = script.readUInt32LE(61);

  // Verify OP_CHECKLOCKTIMEVERIFY at byte 65
  if (script[65] !== OP.CHECKLOCKTIMEVERIFY) {
    throw new Error('Expected OP_CHECKLOCKTIMEVERIFY');
  }

  // Verify OP_DROP at byte 66
  if (script[66] !== OP.DROP) {
    throw new Error('Expected OP_DROP');
  }

  // Verify PUSH33 at byte 67
  if (script[67] !== 0x21) {
    throw new Error('Expected PUSH33 for consumer pubkey');
  }

  // Extract consumer pubkey (bytes 68-100)
  const consumerPubkey = Buffer.from(script.subarray(68, 101));

  // Verify OP_CHECKSIG at byte 101
  if (script[101] !== OP.CHECKSIG) {
    throw new Error('Expected OP_CHECKSIG after consumer pubkey');
  }

  // Verify OP_ENDIF at byte 102
  if (script[102] !== OP.ENDIF) {
    throw new Error('Expected OP_ENDIF');
  }

  return {
    secretHash,
    providerPubkey,
    consumerPubkey,
    timeoutBlock,
  };
}

/**
 * Verify a secret matches a hash
 */
export function verifySecret(secret: Buffer, expectedHash: Buffer): boolean {
  if (secret.length !== HTLC_DEFAULTS.SECRET_SIZE) {
    return false;
  }
  const actualHash = hash160(secret);
  return actualHash.equals(expectedHash);
}

/**
 * Generate a random secret
 */
export function generateSecret(): Buffer {
  const { randomBytes } = require('crypto');
  return randomBytes(HTLC_DEFAULTS.SECRET_SIZE);
}

/**
 * Compute HASH160 of a secret
 */
export function hashSecret(secret: Buffer): Buffer {
  return hash160(secret);
}
