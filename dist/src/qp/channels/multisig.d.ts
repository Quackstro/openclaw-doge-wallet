/**
 * 2-of-2 Multisig for Payment Channels
 */
/**
 * Build a 2-of-2 multisig redeem script
 *
 * Script: OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
 *
 * Note: Public keys must be in lexicographical order for determinism
 */
export declare function build2of2RedeemScript(pubkey1: Buffer, pubkey2: Buffer): Buffer;
/**
 * Sort two public keys lexicographically
 */
export declare function sortPubkeys(a: Buffer, b: Buffer): [Buffer, Buffer];
/**
 * Create a 2-of-2 multisig channel
 */
export declare function createMultisig(consumerPubkey: Buffer, providerPubkey: Buffer): {
    redeemScript: Buffer;
    scriptHash: Buffer;
    p2shAddress: string;
    pubkeyOrder: [Buffer, Buffer];
};
/**
 * Build scriptSig for spending from 2-of-2 multisig
 *
 * Stack: OP_0 <sig1> <sig2> <redeemScript>
 *
 * Note: OP_0 is required due to CHECKMULTISIG bug
 * Signatures must be in same order as pubkeys in redeemScript
 */
export declare function buildMultisigScriptSig(sig1: Buffer, sig2: Buffer, redeemScript: Buffer): Buffer;
/**
 * Parse a 2-of-2 multisig redeem script
 */
export declare function parseMultisigScript(script: Buffer): {
    pubkey1: Buffer;
    pubkey2: Buffer;
};
/**
 * Determine signature order based on pubkey order in script
 */
export declare function getSignatureOrder(redeemScript: Buffer, consumerPubkey: Buffer, providerPubkey: Buffer): 'consumer_first' | 'provider_first';
//# sourceMappingURL=multisig.d.ts.map