/**
 * Chain Integration Types
 * OP_RETURN scanning, registry watching, and transaction building
 */

import type { QPMessage, AdvertiseFlags } from '../types.js';
import type { QPMessageType } from '../types.js';

/** A decoded QP message found on-chain */
export interface OnChainQPMessage {
  /** The decoded QP message */
  message: QPMessage;
  /** Transaction ID containing the OP_RETURN */
  txid: string;
  /** Block height (undefined if unconfirmed) */
  blockHeight?: number;
  /** Number of confirmations */
  confirmations: number;
  /** Timestamp (ISO string from chain) */
  timestamp?: string;
  /** Sender address (first input address) */
  senderAddress: string;
  /** Recipient address (first non-OP_RETURN output address) */
  recipientAddress: string;
  /** Total DOGE sent (non-OP_RETURN outputs, in koinu) */
  amountKoinu: number;
}

/** Filter for scanning QP messages */
export interface ScanFilter {
  /** Only include these message types */
  messageTypes?: QPMessageType[];
  /** Only include messages from this address */
  senderAddress?: string;
  /** Minimum confirmations */
  minConfirmations?: number;
  /** Minimum block height */
  fromBlock?: number;
}

/** A service advertisement found on-chain */
export interface ServiceListing {
  /** Unique key: txid */
  txid: string;
  /** Provider's DOGE address */
  providerAddress: string;
  /** Provider's compressed public key (33 bytes) */
  providerPubkey: Buffer;
  /** Skill code */
  skillCode: number;
  /** Price in koinu */
  priceKoinu: number;
  /** Price unit (0=per-request, etc.) */
  priceUnit: number;
  /** Capability flags */
  flags: AdvertiseFlags;
  /** TTL in blocks */
  ttlBlocks: number;
  /** Metadata description */
  description: string;
  /** Block height when advertised */
  blockHeight?: number;
  /** Confirmations */
  confirmations: number;
  /** Expiry block (blockHeight + ttlBlocks) */
  expiresAtBlock?: number;
  /** Timestamp */
  timestamp?: string;
}

/** Registry watcher state (persisted between runs) */
export interface WatcherState {
  /** Last scanned block height per registry category */
  lastScannedBlock: Record<string, number>;
  /** Timestamp of last successful scan */
  lastScanTime: number;
}

/** Options for the registry watcher */
export interface WatcherOptions {
  /** Registry categories to watch (default: all) */
  categories?: string[];
  /** Minimum confirmations before accepting (default: 1) */
  minConfirmations?: number;
  /** Number of recent txs to scan per address (default: 50) */
  txLimit?: number;
}

/** Chain status snapshot */
export interface ChainStatus {
  /** Current block height */
  blockHeight: number;
  /** Fee estimates */
  feeEstimate: {
    high: number;
    medium: number;
    low: number;
  };
  /** Provider name */
  provider: string;
}
