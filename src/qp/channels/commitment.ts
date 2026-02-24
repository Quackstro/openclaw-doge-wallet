/**
 * Commitment Transaction Builder
 * Time-Decaying Commitments for Payment Channels
 */

import { hash160 } from '../crypto.js';
import { encodeMessage, QPMessageType, QP_MAGIC, QP_VERSION } from '../index.js';
import type { ChannelOpenPayload, ChannelClosePayload } from '../types.js';
import { ChannelCloseType } from '../types.js';
import { buildMultisigScriptSig, getSignatureOrder } from './multisig.js';
import type { 
  ChannelParams, 
  ChannelFunding, 
  CommitmentState, 
  SignedCommitment 
} from './types.js';
import { DEFAULT_CLOSE_FEE_KOINU, DUST_THRESHOLD_KOINU } from './types.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script, PrivateKey, PublicKey } = bitcore;
const CryptoSignature = bitcore.crypto.Signature;

/**
 * Calculate timelock block for a commitment
 * 
 * Time-decaying model: latest commitment unlocks first
 * Commitment #N has timelock: openBlock + ttlBlocks - (N × timelockGap)
 */
export function calculateTimelock(
  params: ChannelParams,
  sequence: number
): number {
  if (params.timelockGap <= 0) {
    throw new Error('timelockGap must be positive');
  }
  const baseTimelock = params.openBlock + params.ttlBlocks;
  const decay = sequence * params.timelockGap;
  const timelock = baseTimelock - decay;
  if (timelock <= params.openBlock) {
    throw new Error(
      `Timelock ${timelock} would be at or before openBlock ${params.openBlock} (sequence ${sequence} exceeds channel capacity)`
    );
  }
  return timelock;
}

/**
 * Calculate maximum calls possible in a channel
 */
export function maxChannelCalls(params: ChannelParams): number {
  if (params.timelockGap <= 0) {
    throw new Error('timelockGap must be positive');
  }
  return Math.floor(params.ttlBlocks / params.timelockGap);
}

/**
 * Create the OP_RETURN data for CHANNEL_OPEN message
 */
export function createChannelOpenOpReturn(params: ChannelParams, depositKoinu: number): Buffer {
  const payload: ChannelOpenPayload = {
    channelId: params.channelId,
    consumerPubkey: params.consumerPubkey,
    providerPubkey: params.providerPubkey,
    ttlBlocks: params.ttlBlocks,
    depositKoinu,
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.CHANNEL_OPEN,
    payload,
  });
}

/**
 * Create the OP_RETURN data for CHANNEL_CLOSE message
 */
export function createChannelCloseOpReturn(
  params: ChannelParams,
  funding: ChannelFunding,
  state: CommitmentState,
  closeType: ChannelCloseType
): Buffer {
  // Convert txid to buffer (reverse byte order)
  const fundingTxidBuf = Buffer.from(funding.fundingTxId, 'hex').reverse();

  const payload: ChannelClosePayload = {
    channelId: params.channelId,
    fundingTxid: fundingTxidBuf.subarray(0, 32),
    consumerFinal: state.consumerBalance,
    providerFinal: state.providerBalance,
    callCount: state.callCount,
    closeType,
    timestamp: Math.floor(Date.now() / 1000),
    reserved: Buffer.alloc(23),
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.CHANNEL_CLOSE,
    payload,
  });
}

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
export function buildCommitmentTx(
  params: ChannelParams,
  funding: ChannelFunding,
  state: CommitmentState,
  consumerAddress: string,
  providerAddress: string
): typeof Transaction {
  const tx = new Transaction();

  // Set nLockTime for this commitment
  tx.lockUntilBlockHeight(state.timelockBlock);

  // Add funding input
  const scriptHash = hash160(funding.redeemScript);
  tx.from({
    txId: funding.fundingTxId,
    outputIndex: funding.fundingOutputIndex,
    satoshis: funding.depositKoinu,
    script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      scriptHash,
      Buffer.from([0x87]),
    ]))),
  });

  // Set sequence to enable CLTV
  tx.inputs[0].sequenceNumber = 0xFFFFFFFE;

  // Output 0: Consumer's balance
  if (state.consumerBalance > 0) {
    tx.to(consumerAddress, state.consumerBalance);
  }

  // Output 1: Provider's balance
  if (state.providerBalance > 0) {
    tx.to(providerAddress, state.providerBalance);
  }

  return tx;
}

/**
 * Sign a commitment transaction
 */
export function signCommitment(
  tx: typeof Transaction,
  privateKey: Buffer,
  redeemScript: Buffer,
  inputAmount: number
): Buffer {
  const privKey = new PrivateKey(privateKey);

  const sighash = Transaction.Sighash.sign(
    tx,
    privKey,
    Transaction.Signature.SIGHASH_ALL,
    0,
    Script.fromBuffer(redeemScript),
    inputAmount
  );

  return Buffer.concat([
    sighash.toDER(),
    Buffer.from([Transaction.Signature.SIGHASH_ALL]),
  ]);
}

/**
 * Verify a commitment signature against a public key
 * 
 * @returns true if the signature is valid for the given tx + pubkey
 */
export function verifyCommitmentSig(
  tx: typeof Transaction,
  sig: Buffer,
  pubkey: Buffer,
  redeemScript: Buffer
): boolean {
  try {
    const cryptoSig = CryptoSignature.fromTxFormat(sig);
    const pubKey = PublicKey.fromBuffer(pubkey);
    return Transaction.Sighash.verify(
      tx,
      cryptoSig,
      pubKey,
      0,
      Script.fromBuffer(redeemScript)
    );
  } catch {
    return false;
  }
}

/**
 * Complete a commitment with both signatures
 */
export function completeCommitment(
  tx: typeof Transaction,
  consumerSig: Buffer,
  providerSig: Buffer,
  redeemScript: Buffer,
  consumerPubkey: Buffer,
  providerPubkey: Buffer
): typeof Transaction {
  // Determine signature order based on pubkey order in script
  const order = getSignatureOrder(redeemScript, consumerPubkey, providerPubkey);
  
  const [sig1, sig2] = order === 'consumer_first' 
    ? [consumerSig, providerSig]
    : [providerSig, consumerSig];

  // Build scriptSig
  const scriptSig = buildMultisigScriptSig(sig1, sig2, redeemScript);
  tx.inputs[0].setScript(Script.fromBuffer(scriptSig));

  return tx;
}

/**
 * Create initial commitment (sequence 0, full balance to consumer)
 */
export function createInitialCommitment(
  params: ChannelParams,
  funding: ChannelFunding,
  consumerAddress: string,
  providerAddress: string
): { state: CommitmentState; tx: typeof Transaction } {
  const state: CommitmentState = {
    sequence: 0,
    consumerBalance: funding.depositKoinu,
    providerBalance: 0,
    callCount: 0,
    timelockBlock: calculateTimelock(params, 0),
  };

  const tx = buildCommitmentTx(params, funding, state, consumerAddress, providerAddress);

  return { state, tx };
}

/**
 * Create next commitment after a payment
 */
export function createNextCommitment(
  params: ChannelParams,
  funding: ChannelFunding,
  currentState: CommitmentState,
  paymentKoinu: number,
  consumerAddress: string,
  providerAddress: string
): { state: CommitmentState; tx: typeof Transaction } {
  // Validate payment
  if (paymentKoinu <= 0) {
    throw new Error('Payment must be positive');
  }
  if (paymentKoinu > currentState.consumerBalance) {
    throw new Error('Insufficient consumer balance');
  }

  const nextSequence = currentState.sequence + 1;
  const maxCalls = maxChannelCalls(params);
  if (nextSequence > maxCalls) {
    throw new Error(`Channel exhausted: max ${maxCalls} calls`);
  }

  const state: CommitmentState = {
    sequence: nextSequence,
    consumerBalance: currentState.consumerBalance - paymentKoinu,
    providerBalance: currentState.providerBalance + paymentKoinu,
    callCount: currentState.callCount + 1,
    timelockBlock: calculateTimelock(params, nextSequence),
  };

  // Balance conservation invariant
  if (state.consumerBalance + state.providerBalance !== funding.depositKoinu) {
    throw new Error(
      `Balance conservation violated: ${state.consumerBalance} + ${state.providerBalance} !== ${funding.depositKoinu}`
    );
  }

  const tx = buildCommitmentTx(params, funding, state, consumerAddress, providerAddress);

  return { state, tx };
}

/**
 * Create a signed commitment record
 */
export function createSignedCommitment(
  state: CommitmentState,
  tx: typeof Transaction,
  consumerSig?: Buffer,
  providerSig?: Buffer
): SignedCommitment {
  return {
    ...state,
    txHex: tx.uncheckedSerialize(),
    consumerSig,
    providerSig,
    isComplete: !!(consumerSig && providerSig),
  };
}

/**
 * Rebuild transaction from signed commitment
 */
export function txFromSignedCommitment(commitment: SignedCommitment): typeof Transaction {
  return new Transaction(commitment.txHex);
}

/**
 * Build cooperative close transaction (no timelocks)
 * 
 * @param feeKoinu - Optional fee override (defaults to DEFAULT_CLOSE_FEE_KOINU)
 */
export function buildCooperativeCloseTx(
  params: ChannelParams,
  funding: ChannelFunding,
  state: CommitmentState,
  consumerAddress: string,
  providerAddress: string,
  feeKoinu: number = DEFAULT_CLOSE_FEE_KOINU
): typeof Transaction {
  if (feeKoinu < 0) {
    throw new Error('Fee cannot be negative');
  }
  if (feeKoinu >= funding.depositKoinu) {
    throw new Error('Fee exceeds deposit');
  }

  const tx = new Transaction();

  // No nLockTime for cooperative close
  
  // Add funding input
  const scriptHash = hash160(funding.redeemScript);
  tx.from({
    txId: funding.fundingTxId,
    outputIndex: funding.fundingOutputIndex,
    satoshis: funding.depositKoinu,
    script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      scriptHash,
      Buffer.from([0x87]),
    ]))),
  });

  // Fee from consumer's balance (or split proportionally)
  const consumerPays = Math.min(state.consumerBalance, feeKoinu);
  const providerPays = feeKoinu - consumerPays;

  // Output 0: Consumer's balance minus fee share
  const consumerOutput = state.consumerBalance - consumerPays;
  if (consumerOutput > 0) {
    if (consumerOutput < DUST_THRESHOLD_KOINU) {
      // Below dust — fold into fee to avoid unspendable output
    } else {
      tx.to(consumerAddress, consumerOutput);
    }
  }

  // Output 1: Provider's balance minus fee share
  const providerOutput = state.providerBalance - providerPays;
  if (providerOutput > 0) {
    if (providerOutput < DUST_THRESHOLD_KOINU) {
      // Below dust — fold into fee
    } else {
      tx.to(providerAddress, providerOutput);
    }
  }

  return tx;
}
