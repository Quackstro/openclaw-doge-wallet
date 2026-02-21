/**
 * HTLC Types for Quackstro Protocol
 * Hash Time-Locked Contracts on Dogecoin
 */

export interface HTLCParams {
  /** HASH160 of the secret (20 bytes) */
  secretHash: Buffer;
  /** Provider's compressed public key (33 bytes) */
  providerPubkey: Buffer;
  /** Consumer's compressed public key (33 bytes) */
  consumerPubkey: Buffer;
  /** Absolute block height for refund timeout */
  timeoutBlock: number;
}

export interface HTLCDetails extends HTLCParams {
  /** The redeem script */
  redeemScript: Buffer;
  /** P2SH address to fund */
  p2shAddress: string;
  /** Script hash (HASH160 of redeem script) */
  scriptHash: Buffer;
}

export interface HTLCFundingParams {
  /** HTLC details (from createHTLC) */
  htlc: HTLCDetails;
  /** Amount to lock in koinu */
  amountKoinu: number;
  /** Fee buffer for claim/refund tx in koinu */
  feeBufferKoinu: number;
  /** Session ID for OP_RETURN */
  sessionId: number;
  /** Skill code for OP_RETURN */
  skillCode: number;
}

export interface HTLCClaimParams {
  /** Funding transaction ID */
  fundingTxId: string;
  /** Output index of the HTLC in funding tx */
  fundingOutputIndex: number;
  /** The secret preimage (32 bytes) */
  secret: Buffer;
  /** The redeem script */
  redeemScript: Buffer;
  /** Provider's private key for signing */
  providerPrivkey: Buffer;
  /** Provider's address to receive funds */
  providerAddress: string;
  /** Amount in the HTLC output (koinu) */
  htlcAmountKoinu: number;
  /** Fee to pay for claim tx (koinu) */
  feeKoinu: number;
}

export interface HTLCRefundParams {
  /** Funding transaction ID */
  fundingTxId: string;
  /** Output index of the HTLC in funding tx */
  fundingOutputIndex: number;
  /** The redeem script */
  redeemScript: Buffer;
  /** Consumer's private key for signing */
  consumerPrivkey: Buffer;
  /** Consumer's address to receive refund */
  consumerAddress: string;
  /** Amount in the HTLC output (koinu) */
  htlcAmountKoinu: number;
  /** Fee to pay for refund tx (koinu) */
  feeKoinu: number;
  /** Timeout block height (for nLockTime) */
  timeoutBlock: number;
}

export interface UTXO {
  txId: string;
  outputIndex: number;
  satoshis: number;
  script: string | Buffer;
}

export enum HTLCState {
  /** HTLC created but not funded */
  CREATED = 'created',
  /** Funding tx broadcast, awaiting confirmation */
  FUNDING_PENDING = 'funding_pending',
  /** Funding tx confirmed, HTLC is active */
  ACTIVE = 'active',
  /** Provider claimed with secret */
  CLAIMED = 'claimed',
  /** Consumer refunded after timeout */
  REFUNDED = 'refunded',
  /** HTLC expired (timeout passed, not yet refunded) */
  EXPIRED = 'expired',
}

export interface HTLCRecord {
  /** Unique identifier */
  id: string;
  /** Current state */
  state: HTLCState;
  /** HTLC parameters */
  params: HTLCParams;
  /** Redeem script */
  redeemScript: Buffer;
  /** P2SH address */
  p2shAddress: string;
  /** The secret (only provider knows) */
  secret?: Buffer;
  /** Funding transaction ID */
  fundingTxId?: string;
  /** Amount locked (koinu) */
  amountKoinu?: number;
  /** Claim transaction ID */
  claimTxId?: string;
  /** Refund transaction ID */
  refundTxId?: string;
  /** Session ID */
  sessionId: number;
  /** Skill code */
  skillCode: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

/** Default HTLC parameters */
export const HTLC_DEFAULTS = {
  /** Default timeout in blocks (~30 minutes) */
  TIMEOUT_BLOCKS: 30,
  /** Default fee buffer in koinu (0.01 DOGE) */
  FEE_BUFFER_KOINU: 1_000_000,
  /** Minimum tool price in koinu (0.001 DOGE) */
  MIN_PRICE_KOINU: 100_000,
  /** Maximum tool price in koinu (~42.9 DOGE, uint32 max) */
  MAX_PRICE_KOINU: 4_294_967_295,
  /** Secret size in bytes */
  SECRET_SIZE: 32,
  /** Hash size in bytes (HASH160 output) */
  HASH_SIZE: 20,
} as const;
