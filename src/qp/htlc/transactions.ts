/**
 * HTLC Transaction Builders
 * Funding, Claim, and Refund transactions for HTLCs
 */

import { hash160 } from '../crypto.js';
import { encodeMessage } from '../messages.js';
import { QPMessageType, QP_MAGIC, QP_VERSION } from '../types.js';
import type { HtlcOfferPayload, HtlcClaimPayload } from '../types.js';
import { buildClaimScriptSig, buildRefundScriptSig } from './script.js';
import type { 
  HTLCDetails, 
  HTLCFundingParams, 
  HTLCClaimParams, 
  HTLCRefundParams,
  UTXO 
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script, PrivateKey } = bitcore;

/**
 * Create the OP_RETURN data for HTLC_OFFER message
 */
export function createHtlcOfferOpReturn(params: {
  sessionId: number;
  secretHash: Buffer;
  timeoutBlock: number;
  toolPriceKoinu: number;
  feeBufferKoinu: number;
  skillCode: number;
  consumerPubkey: Buffer;
}): Buffer {
  const payload: HtlcOfferPayload = {
    sessionId: params.sessionId,
    secretHash: params.secretHash,
    timeoutBlock: params.timeoutBlock,
    toolPrice: params.toolPriceKoinu,
    feeBuffer: params.feeBufferKoinu,
    skillCode: params.skillCode,
    consumerPubkey: params.consumerPubkey,
    reserved: Buffer.alloc(5),
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.HTLC_OFFER,
    payload,
  });
}

/**
 * Create the OP_RETURN data for HTLC_CLAIM message
 */
export function createHtlcClaimOpReturn(params: {
  sessionId: number;
  fundingTxId: string;
  claimedKoinu: number;
}): Buffer {
  // Convert txid to buffer (reverse byte order for display vs internal)
  const txidBuf = Buffer.from(params.fundingTxId, 'hex').reverse();
  
  const payload: HtlcClaimPayload = {
    sessionId: params.sessionId,
    fundingTxid: txidBuf.subarray(0, 32),
    claimedKoinu: params.claimedKoinu,
    timestamp: Math.floor(Date.now() / 1000),
    reserved: Buffer.alloc(32),
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.HTLC_CLAIM,
    payload,
  });
}

/**
 * Build an HTLC funding transaction
 * 
 * Outputs:
 *   0: P2SH HTLC (tool_price + fee_buffer)
 *   1: OP_RETURN with HTLC_OFFER metadata
 *   2: Change (if any)
 */
export function buildFundingTransaction(params: {
  htlc: HTLCDetails;
  amountKoinu: number;
  feeBufferKoinu: number;
  sessionId: number;
  skillCode: number;
  consumerPubkey: Buffer;
  utxos: UTXO[];
  changeAddress: string;
  feeKoinu: number;
}): typeof Transaction {
  const {
    htlc,
    amountKoinu,
    feeBufferKoinu,
    sessionId,
    skillCode,
    consumerPubkey,
    utxos,
    changeAddress,
    feeKoinu,
  } = params;

  const totalHtlcAmount = amountKoinu + feeBufferKoinu;
  
  // Create transaction
  const tx = new Transaction();

  // Add inputs
  for (const utxo of utxos) {
    tx.from({
      txId: utxo.txId,
      outputIndex: utxo.outputIndex,
      satoshis: utxo.satoshis,
      script: utxo.script,
    });
  }

  // Output 0: P2SH HTLC
  const p2shScript = Script.buildScriptHashOut(
    Script.fromBuffer(Buffer.concat([
      Buffer.from([0xa9, 0x14]), // OP_HASH160 PUSH20
      htlc.scriptHash,
      Buffer.from([0x87]), // OP_EQUAL
    ]))
  );
  tx.addOutput(new Transaction.Output({
    satoshis: totalHtlcAmount,
    script: htlc.p2shAddress,
  }));

  // Output 1: OP_RETURN with HTLC_OFFER
  const opReturnData = createHtlcOfferOpReturn({
    sessionId,
    secretHash: htlc.secretHash,
    timeoutBlock: htlc.timeoutBlock,
    toolPriceKoinu: amountKoinu,
    feeBufferKoinu,
    skillCode,
    consumerPubkey,
  });
  tx.addOutput(new Transaction.Output({
    satoshis: 0,
    script: Script.buildDataOut(opReturnData),
  }));

  // Calculate change
  const totalInput = utxos.reduce((sum, u) => sum + u.satoshis, 0);
  const totalOutput = totalHtlcAmount + feeKoinu;
  const change = totalInput - totalOutput;

  if (change < 0) {
    throw new Error(`Insufficient funds: need ${totalOutput} koinu, have ${totalInput}`);
  }

  // Output 2: Change (if significant)
  if (change > 100000) { // Only add change if > 0.001 DOGE
    tx.change(changeAddress);
  }

  tx.fee(feeKoinu);

  return tx;
}

/**
 * Build an HTLC claim transaction
 * 
 * Provider claims the HTLC by revealing the secret
 */
export function buildClaimTransaction(params: HTLCClaimParams): typeof Transaction {
  const {
    fundingTxId,
    fundingOutputIndex,
    secret,
    redeemScript,
    providerPrivkey,
    providerAddress,
    htlcAmountKoinu,
    feeKoinu,
  } = params;

  // Create transaction
  const tx = new Transaction();

  // Add HTLC input
  const scriptHash = hash160(redeemScript);
  tx.from({
    txId: fundingTxId,
    outputIndex: fundingOutputIndex,
    satoshis: htlcAmountKoinu,
    script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      scriptHash,
      Buffer.from([0x87]),
    ]))),
  });

  // Output: Provider receives funds
  const outputAmount = htlcAmountKoinu - feeKoinu;
  if (outputAmount <= 0) {
    throw new Error('HTLC amount too small to cover fees');
  }
  tx.to(providerAddress, outputAmount);

  // Sign the transaction
  const privKey = new PrivateKey(providerPrivkey);
  
  // Get signature
  const sighash = Transaction.Sighash.sign(
    tx,
    privKey,
    Transaction.Signature.SIGHASH_ALL,
    0,
    Script.fromBuffer(redeemScript),
    htlcAmountKoinu
  );

  // Build DER signature with SIGHASH byte
  const signature = Buffer.concat([
    sighash.toDER(),
    Buffer.from([Transaction.Signature.SIGHASH_ALL]),
  ]);

  // Build scriptSig
  const scriptSig = buildClaimScriptSig(signature, secret, redeemScript);

  // Set input script
  tx.inputs[0].setScript(Script.fromBuffer(scriptSig));

  return tx;
}

/**
 * Build an HTLC refund transaction
 * 
 * Consumer refunds the HTLC after timeout
 */
export function buildRefundTransaction(params: HTLCRefundParams): typeof Transaction {
  const {
    fundingTxId,
    fundingOutputIndex,
    redeemScript,
    consumerPrivkey,
    consumerAddress,
    htlcAmountKoinu,
    feeKoinu,
    timeoutBlock,
  } = params;

  // Create transaction with nLockTime
  const tx = new Transaction();
  tx.lockUntilBlockHeight(timeoutBlock);

  // Add HTLC input with sequence number that enables CLTV
  const scriptHash = hash160(redeemScript);
  tx.from({
    txId: fundingTxId,
    outputIndex: fundingOutputIndex,
    satoshis: htlcAmountKoinu,
    script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
      Buffer.from([0xa9, 0x14]),
      scriptHash,
      Buffer.from([0x87]),
    ]))),
  });

  // Set sequence number to allow CLTV (must be < 0xFFFFFFFF)
  tx.inputs[0].sequenceNumber = 0xFFFFFFFE;

  // Output: Consumer receives refund
  const outputAmount = htlcAmountKoinu - feeKoinu;
  if (outputAmount <= 0) {
    throw new Error('HTLC amount too small to cover fees');
  }
  tx.to(consumerAddress, outputAmount);

  // Sign the transaction
  const privKey = new PrivateKey(consumerPrivkey);
  
  // Get signature
  const sighash = Transaction.Sighash.sign(
    tx,
    privKey,
    Transaction.Signature.SIGHASH_ALL,
    0,
    Script.fromBuffer(redeemScript),
    htlcAmountKoinu
  );

  // Build DER signature with SIGHASH byte
  const signature = Buffer.concat([
    sighash.toDER(),
    Buffer.from([Transaction.Signature.SIGHASH_ALL]),
  ]);

  // Build scriptSig
  const scriptSig = buildRefundScriptSig(signature, redeemScript);

  // Set input script
  tx.inputs[0].setScript(Script.fromBuffer(scriptSig));

  return tx;
}

/**
 * Serialize a transaction to hex for broadcasting
 */
export function serializeTransaction(tx: typeof Transaction): string {
  return tx.serialize();
}

/**
 * Get transaction ID
 */
export function getTransactionId(tx: typeof Transaction): string {
  return tx.id;
}

/**
 * Estimate fee for a transaction based on size
 * 
 * DOGE recommended fee: 1 DOGE per KB (but often 0.01 DOGE is enough)
 */
export function estimateFee(txSizeBytes: number, feePerKb: number = 100_000_000): number {
  return Math.ceil(txSizeBytes * feePerKb / 1000);
}

/**
 * Typical transaction sizes:
 * - Funding tx (1 input, 3 outputs): ~250 bytes
 * - Claim tx (1 input, 1 output): ~300 bytes (includes secret)
 * - Refund tx (1 input, 1 output): ~250 bytes
 */
export const TX_SIZE_ESTIMATES = {
  FUNDING: 250,
  CLAIM: 300,
  REFUND: 250,
} as const;
