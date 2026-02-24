/**
 * Payment Channel Types
 * 2-of-2 Multisig Channels with Time-Decaying Commitments
 */

export interface ChannelParams {
  /** Unique channel identifier */
  channelId: number;
  /** Consumer's compressed public key (33 bytes) */
  consumerPubkey: Buffer;
  /** Provider's compressed public key (33 bytes) */
  providerPubkey: Buffer;
  /** Channel time-to-live in blocks */
  ttlBlocks: number;
  /** Block height when channel opened */
  openBlock: number;
  /** Timelock gap between commitments (blocks) */
  timelockGap: number;
}

export interface ChannelFunding {
  /** Funding transaction ID */
  fundingTxId: string;
  /** Output index of the multisig */
  fundingOutputIndex: number;
  /** Total deposit in koinu */
  depositKoinu: number;
  /** Redeem script for 2-of-2 multisig */
  redeemScript: Buffer;
  /** P2SH address of the channel */
  p2shAddress: string;
}

export interface CommitmentState {
  /** Commitment sequence number (0 = initial) */
  sequence: number;
  /** Consumer's balance in koinu */
  consumerBalance: number;
  /** Provider's balance in koinu */
  providerBalance: number;
  /** Total calls made in channel */
  callCount: number;
  /** Timelock block height for this commitment */
  timelockBlock: number;
}

export interface SignedCommitment extends CommitmentState {
  /** Serialized commitment transaction */
  txHex: string;
  /** Consumer's signature */
  consumerSig?: Buffer;
  /** Provider's signature */
  providerSig?: Buffer;
  /** Fully signed (both signatures present) */
  isComplete: boolean;
}

export enum ChannelState {
  /** Channel parameters agreed, not yet funded */
  CREATED = 'created',
  /** Funding tx broadcast, awaiting confirmation */
  FUNDING_PENDING = 'funding_pending',
  /** Channel is open and active */
  OPEN = 'open',
  /** Close initiated, awaiting confirmation */
  CLOSING = 'closing',
  /** Channel closed cooperatively */
  CLOSED_COOPERATIVE = 'closed_cooperative',
  /** Channel closed unilaterally by consumer */
  CLOSED_UNILATERAL_CONSUMER = 'closed_unilateral_consumer',
  /** Channel closed unilaterally by provider */
  CLOSED_UNILATERAL_PROVIDER = 'closed_unilateral_provider',
  /** Channel closed due to timeout */
  CLOSED_TIMEOUT = 'closed_timeout',
  /** Channel in dispute */
  DISPUTED = 'disputed',
}

export interface ChannelRecord {
  /** Unique identifier */
  id: string;
  /** Current state */
  state: ChannelState;
  /** Channel parameters */
  params: ChannelParams;
  /** Funding information */
  funding?: ChannelFunding;
  /** Latest commitment state */
  latestCommitment?: SignedCommitment;
  /** Initial refund commitment (safety net) */
  refundCommitment?: SignedCommitment;
  /** Close transaction ID */
  closeTxId?: string;
  /** Our role in the channel */
  role: 'consumer' | 'provider';
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
}

export interface ChannelConfig {
  /** Minimum deposit in koinu */
  minDepositKoinu: number;
  /** Maximum deposit in koinu */
  maxDepositKoinu: number;
  /** Default TTL in blocks (~72 hours) */
  defaultTtlBlocks: number;
  /** Default timelock gap between commitments */
  defaultTimelockGap: number;
  /** Maximum concurrent channels */
  maxConcurrentChannels: number;
  /** Cooperative close timeout in blocks */
  cooperativeCloseTimeout: number;
}

/** Dust threshold — outputs below this are unspendable (1 DOGE) */
export const DUST_THRESHOLD_KOINU = 100_000_000;

/** Default cooperative close fee (0.01 DOGE) */
export const DEFAULT_CLOSE_FEE_KOINU = 1_000_000;

/** Default channel configuration */
export const CHANNEL_DEFAULTS: ChannelConfig = {
  /** Minimum 5 DOGE deposit */
  minDepositKoinu: 500_000_000,
  /** Maximum 10,000 DOGE deposit */
  maxDepositKoinu: 1_000_000_000_000,
  /** 72 hours at 1 block/min */
  defaultTtlBlocks: 4320,
  /** 10 blocks (~10 minutes) between commitment timelocks */
  defaultTimelockGap: 10,
  /** Maximum 10 concurrent channels */
  maxConcurrentChannels: 10,
  /** 30 blocks for cooperative close */
  cooperativeCloseTimeout: 30,
} as const;

export interface ChannelUpdate {
  /** Amount to transfer from consumer to provider (koinu) */
  paymentKoinu: number;
  /** Tool call metadata (optional) */
  metadata?: {
    skillCode: number;
    sessionId: number;
  };
}

export interface CloseRequest {
  /** Final consumer balance */
  consumerFinal: number;
  /** Final provider balance */
  providerFinal: number;
  /** Signature of requesting party */
  signature: Buffer;
  /** Timestamp of request */
  timestamp: number;
}
