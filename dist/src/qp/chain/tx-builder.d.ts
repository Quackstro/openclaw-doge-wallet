/**
 * QP Transaction Builder
 * High-level helpers for building QP-annotated Dogecoin transactions.
 */
import type { AdvertiseFlags } from '../types.js';
import type { RegistryCategory } from '../types.js';
import type { DogeApiProvider, UTXO } from '../../types.js';
declare const Transaction: any;
/** Parameters for building a SERVICE_ADVERTISE transaction */
export interface AdvertiseParams {
    /** Skill code (uint16) */
    skillCode: number;
    /** Price in koinu (uint32) */
    priceKoinu: number;
    /** Price unit */
    priceUnit: number;
    /** Capability flags */
    flags: AdvertiseFlags;
    /** TTL in blocks */
    ttlBlocks: number;
    /** Provider's compressed public key (33 bytes) */
    pubkey: Buffer;
    /** Description (max 20 chars, padded/truncated) */
    description: string;
    /** Registry category to send to */
    category: RegistryCategory;
}
/** Parameters for building a RATING transaction */
export interface RatingParams {
    /** Session ID */
    sessionId: number;
    /** Provider's address to send rating tx to */
    providerAddress: string;
    /** Provider's compressed public key (33 bytes) */
    ratedAgent: Buffer;
    /** Skill code that was used */
    skillCode: number;
    /** Payment txid (32 bytes) */
    paymentTxid: Buffer;
    /** Rating (0-255) */
    rating: number;
    /** Tip included flag */
    tipIncluded: boolean;
    /** Dispute flag */
    dispute: boolean;
}
/**
 * Build the OP_RETURN output data for a SERVICE_ADVERTISE message.
 */
export declare function buildAdvertiseOpReturn(params: AdvertiseParams): Buffer;
/**
 * Build a SERVICE_ADVERTISE transaction.
 *
 * Outputs:
 *   0: Dust amount to registry address (makes it scannable)
 *   1: OP_RETURN with SERVICE_ADVERTISE payload
 *   2: Change
 */
export declare function buildAdvertiseTx(params: {
    advertise: AdvertiseParams;
    utxos: UTXO[];
    changeAddress: string;
    feeKoinu?: number;
}): typeof Transaction;
/**
 * Build the OP_RETURN output data for a RATING message.
 */
export declare function buildRatingOpReturn(params: RatingParams): Buffer;
/**
 * Build a RATING transaction.
 */
export declare function buildRatingTx(params: {
    rating: RatingParams;
    utxos: UTXO[];
    changeAddress: string;
    feeKoinu?: number;
}): typeof Transaction;
/**
 * Sign a transaction with a private key.
 * IMPORTANT: Caller is responsible for zeroing privateKeyBuf after use.
 */
export declare function signTx(tx: typeof Transaction, privateKeyBuf: Buffer): typeof Transaction;
/**
 * Serialize a transaction for broadcasting with structural validation.
 * Disables fee checks (QP txs have non-standard fee ratios) but validates
 * output amounts, input completeness, etc.
 */
export declare function serializeTx(tx: typeof Transaction): string;
/**
 * Broadcast a signed transaction.
 */
export declare function broadcastTx(provider: DogeApiProvider, txHex: string): Promise<{
    txid: string;
}>;
export {};
//# sourceMappingURL=tx-builder.d.ts.map