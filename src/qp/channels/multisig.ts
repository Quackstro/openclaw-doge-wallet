/**
 * 2-of-2 Multisig for Payment Channels
 */

import { hash160 } from '../crypto.js';
import { encodeP2SHAddress } from '../registry.js';

// Bitcoin Script opcodes
const OP = {
  _2: 0x52,
  CHECKMULTISIG: 0xae,
} as const;

/**
 * Build a 2-of-2 multisig redeem script
 * 
 * Script: OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
 * 
 * Note: Public keys must be in lexicographical order for determinism
 */
export function build2of2RedeemScript(
  pubkey1: Buffer,
  pubkey2: Buffer
): Buffer {
  if (pubkey1.length !== 33 || pubkey2.length !== 33) {
    throw new Error('Public keys must be 33 bytes (compressed)');
  }

  // Sort keys lexicographically for deterministic script
  const [first, second] = sortPubkeys(pubkey1, pubkey2);

  // Build script
  const script = Buffer.concat([
    Buffer.from([OP._2]),         // OP_2
    Buffer.from([0x21]),          // Push 33 bytes
    first,                         // First pubkey
    Buffer.from([0x21]),          // Push 33 bytes
    second,                        // Second pubkey
    Buffer.from([OP._2]),         // OP_2
    Buffer.from([OP.CHECKMULTISIG]), // OP_CHECKMULTISIG
  ]);

  // Should be 71 bytes: 1 + 1 + 33 + 1 + 33 + 1 + 1
  if (script.length !== 71) {
    throw new Error(`Unexpected script length: ${script.length}`);
  }

  return script;
}

/**
 * Sort two public keys lexicographically
 */
export function sortPubkeys(a: Buffer, b: Buffer): [Buffer, Buffer] {
  const cmp = Buffer.compare(a, b);
  return cmp <= 0 ? [a, b] : [b, a];
}

/**
 * Create a 2-of-2 multisig channel
 */
export function createMultisig(
  consumerPubkey: Buffer,
  providerPubkey: Buffer
): {
  redeemScript: Buffer;
  scriptHash: Buffer;
  p2shAddress: string;
  pubkeyOrder: [Buffer, Buffer];
} {
  const redeemScript = build2of2RedeemScript(consumerPubkey, providerPubkey);
  const scriptHash = hash160(redeemScript);
  const p2shAddress = encodeP2SHAddress(scriptHash);
  const pubkeyOrder = sortPubkeys(consumerPubkey, providerPubkey);

  return {
    redeemScript,
    scriptHash,
    p2shAddress,
    pubkeyOrder,
  };
}

/**
 * Build scriptSig for spending from 2-of-2 multisig
 * 
 * Stack: OP_0 <sig1> <sig2> <redeemScript>
 * 
 * Note: OP_0 is required due to CHECKMULTISIG bug
 * Signatures must be in same order as pubkeys in redeemScript
 */
export function buildMultisigScriptSig(
  sig1: Buffer,
  sig2: Buffer,
  redeemScript: Buffer
): Buffer {
  const parts: Buffer[] = [];

  // OP_0 (CHECKMULTISIG bug workaround)
  parts.push(Buffer.from([0x00]));

  // Push first signature
  if (sig1.length <= 75) {
    parts.push(Buffer.from([sig1.length]));
  } else {
    parts.push(Buffer.from([0x4c, sig1.length])); // OP_PUSHDATA1
  }
  parts.push(sig1);

  // Push second signature
  if (sig2.length <= 75) {
    parts.push(Buffer.from([sig2.length]));
  } else {
    parts.push(Buffer.from([0x4c, sig2.length]));
  }
  parts.push(sig2);

  // Push redeem script
  if (redeemScript.length <= 75) {
    parts.push(Buffer.from([redeemScript.length]));
  } else if (redeemScript.length <= 255) {
    parts.push(Buffer.from([0x4c, redeemScript.length]));
  } else {
    throw new Error('Redeem script too large');
  }
  parts.push(redeemScript);

  return Buffer.concat(parts);
}

/**
 * Parse a 2-of-2 multisig redeem script
 */
export function parseMultisigScript(script: Buffer): {
  pubkey1: Buffer;
  pubkey2: Buffer;
} {
  if (script.length !== 71) {
    throw new Error(`Invalid 2-of-2 script length: ${script.length}`);
  }

  if (script[0] !== OP._2) {
    throw new Error('Script must start with OP_2');
  }
  if (script[1] !== 0x21) {
    throw new Error('Expected PUSH33 for first pubkey');
  }

  const pubkey1 = Buffer.from(script.subarray(2, 35));

  if (script[35] !== 0x21) {
    throw new Error('Expected PUSH33 for second pubkey');
  }

  const pubkey2 = Buffer.from(script.subarray(36, 69));

  if (script[69] !== OP._2) {
    throw new Error('Expected OP_2 before CHECKMULTISIG');
  }
  if (script[70] !== OP.CHECKMULTISIG) {
    throw new Error('Expected OP_CHECKMULTISIG');
  }

  return { pubkey1, pubkey2 };
}

/**
 * Determine signature order based on pubkey order in script
 */
export function getSignatureOrder(
  redeemScript: Buffer,
  consumerPubkey: Buffer,
  providerPubkey: Buffer
): 'consumer_first' | 'provider_first' {
  const { pubkey1 } = parseMultisigScript(redeemScript);
  
  if (pubkey1.equals(consumerPubkey)) {
    return 'consumer_first';
  } else if (pubkey1.equals(providerPubkey)) {
    return 'provider_first';
  } else {
    throw new Error('Neither pubkey matches first pubkey in script');
  }
}
