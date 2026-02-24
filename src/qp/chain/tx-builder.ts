/**
 * QP Transaction Builder
 * High-level helpers for building QP-annotated Dogecoin transactions.
 */

import { encodeMessage } from '../messages.js';
import { QPMessageType, QP_MAGIC, QP_VERSION, PriceUnit } from '../types.js';
import type {
  ServiceAdvertisePayload,
  RatingPayload,
  AdvertiseFlags,
} from '../types.js';
import { getRegistryAddress } from '../registry.js';
import type { RegistryCategory } from '../types.js';
import type { DogeApiProvider, UTXO } from '../../types.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script, PrivateKey } = bitcore;

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
export function buildAdvertiseOpReturn(params: AdvertiseParams): Buffer {
  // Generate random nonce
  const nonce = Buffer.alloc(4);
  require('crypto').randomFillSync(nonce);

  const payload: ServiceAdvertisePayload = {
    skillCode: params.skillCode,
    priceKoinu: params.priceKoinu,
    priceUnit: params.priceUnit,
    flags: params.flags,
    ttlBlocks: params.ttlBlocks,
    nonce,
    pubkey: params.pubkey,
    metadata: params.description.padEnd(20, '\0').slice(0, 20),
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.SERVICE_ADVERTISE,
    payload,
  });
}

/**
 * Build a SERVICE_ADVERTISE transaction.
 *
 * Outputs:
 *   0: Dust amount to registry address (makes it scannable)
 *   1: OP_RETURN with SERVICE_ADVERTISE payload
 *   2: Change
 */
export function buildAdvertiseTx(params: {
  advertise: AdvertiseParams;
  utxos: UTXO[];
  changeAddress: string;
  feeKoinu?: number;
}): typeof Transaction {
  const { advertise, utxos, changeAddress, feeKoinu = 1_000_000 } = params;

  const registryAddress = getRegistryAddress(advertise.category);
  const opReturnData = buildAdvertiseOpReturn(advertise);
  const dustAmount = 100_000_000; // 1 DOGE dust to registry

  const tx = new Transaction();

  // Add inputs
  for (const utxo of utxos) {
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.amount,
      script: utxo.scriptPubKey,
    });
  }

  // Output 0: Dust to registry address
  tx.to(registryAddress, dustAmount);

  // Output 1: OP_RETURN
  tx.addOutput(new Transaction.Output({
    satoshis: 0,
    script: Script.buildDataOut(opReturnData),
  }));

  // Change
  tx.change(changeAddress);
  tx.fee(feeKoinu);

  return tx;
}

/**
 * Build the OP_RETURN output data for a RATING message.
 */
export function buildRatingOpReturn(params: RatingParams): Buffer {
  const payload: RatingPayload = {
    sessionId: params.sessionId,
    ratedAgent: params.ratedAgent,
    rating: params.rating,
    flags: {
      tipIncluded: params.tipIncluded,
      dispute: params.dispute,
    },
    skillCode: params.skillCode,
    paymentTxid: params.paymentTxid,
    reserved: Buffer.alloc(3),
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.RATING,
    payload,
  });
}

/**
 * Build a RATING transaction.
 */
export function buildRatingTx(params: {
  rating: RatingParams;
  utxos: UTXO[];
  changeAddress: string;
  feeKoinu?: number;
}): typeof Transaction {
  const { rating, utxos, changeAddress, feeKoinu = 1_000_000 } = params;

  const opReturnData = buildRatingOpReturn(rating);
  const dustAmount = 100_000_000; // 1 DOGE to provider

  const tx = new Transaction();

  for (const utxo of utxos) {
    tx.from({
      txId: utxo.txid,
      outputIndex: utxo.vout,
      satoshis: utxo.amount,
      script: utxo.scriptPubKey,
    });
  }

  // Output 0: Payment to provider
  tx.to(rating.providerAddress, dustAmount);

  // Output 1: OP_RETURN with rating
  tx.addOutput(new Transaction.Output({
    satoshis: 0,
    script: Script.buildDataOut(opReturnData),
  }));

  tx.change(changeAddress);
  tx.fee(feeKoinu);

  return tx;
}

/**
 * Sign a transaction with a private key.
 */
export function signTx(
  tx: typeof Transaction,
  privateKeyBuf: Buffer
): typeof Transaction {
  const privKey = new PrivateKey(privateKeyBuf);
  tx.sign(privKey);
  return tx;
}

/**
 * Serialize a transaction for broadcasting.
 */
export function serializeTx(tx: typeof Transaction): string {
  return tx.uncheckedSerialize();
}

/**
 * Broadcast a signed transaction.
 */
export async function broadcastTx(
  provider: DogeApiProvider,
  txHex: string
): Promise<{ txid: string }> {
  return provider.broadcastTx(txHex);
}
