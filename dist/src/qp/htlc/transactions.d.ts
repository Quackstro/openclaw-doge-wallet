/**
 * HTLC Transaction Builders
 * Funding, Claim, and Refund transactions for HTLCs
 */
import type { HTLCDetails, HTLCClaimParams, HTLCRefundParams, UTXO } from './types.js';
declare const Transaction: any;
/**
 * Create the OP_RETURN data for HTLC_OFFER message
 */
export declare function createHtlcOfferOpReturn(params: {
    sessionId: number;
    secretHash: Buffer;
    timeoutBlock: number;
    toolPriceKoinu: number;
    feeBufferKoinu: number;
    skillCode: number;
    consumerPubkey: Buffer;
}): Buffer;
/**
 * Create the OP_RETURN data for HTLC_CLAIM message
 */
export declare function createHtlcClaimOpReturn(params: {
    sessionId: number;
    fundingTxId: string;
    claimedKoinu: number;
}): Buffer;
/**
 * Build an HTLC funding transaction
 *
 * Outputs:
 *   0: P2SH HTLC (tool_price + fee_buffer)
 *   1: OP_RETURN with HTLC_OFFER metadata
 *   2: Change (if any)
 */
export declare function buildFundingTransaction(params: {
    htlc: HTLCDetails;
    amountKoinu: number;
    feeBufferKoinu: number;
    sessionId: number;
    skillCode: number;
    consumerPubkey: Buffer;
    utxos: UTXO[];
    changeAddress: string;
    feeKoinu: number;
}): typeof Transaction;
/**
 * Build an HTLC claim transaction
 *
 * Provider claims the HTLC by revealing the secret
 */
export declare function buildClaimTransaction(params: HTLCClaimParams): typeof Transaction;
/**
 * Build an HTLC refund transaction
 *
 * Consumer refunds the HTLC after timeout
 */
export declare function buildRefundTransaction(params: HTLCRefundParams): typeof Transaction;
/**
 * Serialize a transaction to hex for broadcasting.
 *
 * Uses checkedSerialize with fee check disabled — HTLC txs have
 * non-standard fee/size ratios due to script complexity, but we still
 * want other checks (invalid satoshis, output > input, dust).
 */
export declare function serializeTransaction(tx: typeof Transaction): string;
/**
 * Get transaction ID
 */
export declare function getTransactionId(tx: typeof Transaction): string;
/**
 * Estimate fee for a transaction based on size
 *
 * DOGE recommended fee: 1 DOGE per KB (but often 0.01 DOGE is enough)
 */
export declare function estimateFee(txSizeBytes: number, feePerKb?: number): number;
/**
 * Typical transaction sizes:
 * - Funding tx (1 input, 3 outputs): ~250 bytes
 * - Claim tx (1 input, 1 output): ~300 bytes (includes secret)
 * - Refund tx (1 input, 1 output): ~250 bytes
 */
export declare const TX_SIZE_ESTIMATES: {
    readonly FUNDING: 250;
    readonly CLAIM: 300;
    readonly REFUND: 250;
};
export {};
//# sourceMappingURL=transactions.d.ts.map