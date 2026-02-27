/**
 * Commitment Transaction Builder
 * Time-Decaying Commitments for Payment Channels
 */
import type { ChannelParams, ChannelFunding, CommitmentState, SignedCommitment } from './types.js';
declare const Transaction: any;
/**
 * Calculate timelock block for a commitment
 *
 * Time-decaying model: latest commitment unlocks first
 * Commitment #N has timelock: openBlock + ttlBlocks - (N × timelockGap)
 */
export declare function calculateTimelock(params: ChannelParams, sequence: number): number;
/**
 * Calculate maximum calls possible in a channel
 */
export declare function maxChannelCalls(params: ChannelParams): number;
/**
 * Build an unsigned commitment transaction
 *
 * Commitment structure:
 * - Input: Channel funding multisig
 * - Output 0: Consumer's balance (timelocked)
 * - Output 1: Provider's balance (immediate)
 * - nLockTime: commitment timelock
 *
 * NOTE: Commitment txs are intentionally 0-fee. They are held off-chain and
 * only broadcast as a last resort (unilateral close). The broadcaster should
 * use CPFP (child-pays-for-parent) to incentivise confirmation.
 */
export declare function buildCommitmentTx(params: ChannelParams, funding: ChannelFunding, state: CommitmentState, consumerAddress: string, providerAddress: string): typeof Transaction;
/**
 * Sign a commitment transaction
 */
export declare function signCommitment(tx: typeof Transaction, privateKey: Buffer, redeemScript: Buffer, inputAmount: number): Buffer;
/**
 * Verify a commitment signature against a public key
 *
 * @returns true if the signature is valid for the given tx + pubkey
 */
export declare function verifyCommitmentSig(tx: typeof Transaction, sig: Buffer, pubkey: Buffer, redeemScript: Buffer): boolean;
/**
 * Complete a commitment with both signatures
 */
export declare function completeCommitment(tx: typeof Transaction, consumerSig: Buffer, providerSig: Buffer, redeemScript: Buffer, consumerPubkey: Buffer, providerPubkey: Buffer): typeof Transaction;
/**
 * Create initial commitment (sequence 0, full balance to consumer)
 */
export declare function createInitialCommitment(params: ChannelParams, funding: ChannelFunding, consumerAddress: string, providerAddress: string): {
    state: CommitmentState;
    tx: typeof Transaction;
};
/**
 * Create next commitment after a payment
 */
export declare function createNextCommitment(params: ChannelParams, funding: ChannelFunding, currentState: CommitmentState, paymentKoinu: number, consumerAddress: string, providerAddress: string): {
    state: CommitmentState;
    tx: typeof Transaction;
};
/**
 * Create a signed commitment record
 */
export declare function createSignedCommitment(state: CommitmentState, tx: typeof Transaction, consumerSig?: Buffer, providerSig?: Buffer): SignedCommitment;
/**
 * Rebuild transaction from signed commitment
 */
export declare function txFromSignedCommitment(commitment: SignedCommitment): typeof Transaction;
/**
 * Build cooperative close transaction (no timelocks)
 *
 * @param feeKoinu - Optional fee override (defaults to DEFAULT_CLOSE_FEE_KOINU)
 */
export declare function buildCooperativeCloseTx(params: ChannelParams, funding: ChannelFunding, state: CommitmentState, consumerAddress: string, providerAddress: string, feeKoinu?: number): typeof Transaction;
export {};
//# sourceMappingURL=commitment.d.ts.map