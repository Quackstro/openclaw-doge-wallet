/**
 * OP_RETURN Scanner
 * Scans Dogecoin transactions for QP protocol messages
 */

import { decodeMessage, isQPMessage } from '../messages.js';
import type { QPMessage } from '../types.js';
import type { DogeApiProvider, Transaction as ChainTx } from '../../types.js';
import type { OnChainQPMessage, ScanFilter } from './types.js';

/**
 * Extract OP_RETURN data from a transaction's outputs.
 *
 * BlockCypher returns the output script hex. OP_RETURN scripts start with 0x6a
 * followed by a push opcode + data.
 */
export function extractOpReturn(tx: ChainTx): Buffer | null {
  for (const out of tx.outputs) {
    if (!out.script) continue;

    // OP_RETURN scripts: scriptType may be "null-data" or script starts with 6a
    const isNullData = out.scriptType === 'null-data';
    const startsWithOpReturn = out.script.startsWith('6a');

    if (!isNullData && !startsWithOpReturn) continue;

    try {
      const scriptBuf = Buffer.from(out.script, 'hex');

      // Script format: OP_RETURN (0x6a) + push opcode + data
      if (scriptBuf[0] !== 0x6a) continue;

      let dataStart: number;
      let dataLen: number;

      if (scriptBuf[1] <= 0x4b) {
        // Direct push: next byte is length
        dataLen = scriptBuf[1];
        dataStart = 2;
      } else if (scriptBuf[1] === 0x4c) {
        // OP_PUSHDATA1
        dataLen = scriptBuf[2];
        dataStart = 3;
      } else if (scriptBuf[1] === 0x4d) {
        // OP_PUSHDATA2
        dataLen = scriptBuf.readUInt16LE(2);
        dataStart = 4;
      } else {
        continue;
      }

      if (dataStart + dataLen > scriptBuf.length) continue;

      return scriptBuf.subarray(dataStart, dataStart + dataLen);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Try to decode a QP message from a transaction.
 * Returns null if the tx has no QP OP_RETURN.
 */
export function decodeQPFromTx(tx: ChainTx): OnChainQPMessage | null {
  const opReturnData = extractOpReturn(tx);
  if (!opReturnData || opReturnData.length < 4) return null;
  if (!isQPMessage(opReturnData)) return null;

  let message: QPMessage;
  try {
    message = decodeMessage(opReturnData);
  } catch {
    return null; // Malformed QP message
  }

  // Sender = first input address
  const senderAddress = tx.inputs[0]?.address ?? 'unknown';

  // Recipient = first non-OP_RETURN output address
  let recipientAddress = 'unknown';
  let amountKoinu = 0;
  for (const out of tx.outputs) {
    if (out.scriptType === 'null-data') continue;
    if (out.script?.startsWith('6a')) continue;
    if (out.amount > 0) {
      if (recipientAddress === 'unknown') {
        recipientAddress = out.address;
      }
      amountKoinu += out.amount;
    }
  }

  return {
    message,
    txid: tx.txid,
    blockHeight: tx.blockHeight,
    confirmations: tx.confirmations,
    timestamp: tx.timestamp,
    senderAddress,
    recipientAddress,
    amountKoinu,
  };
}

/**
 * Apply a filter to an on-chain QP message
 */
function matchesFilter(msg: OnChainQPMessage, filter: ScanFilter): boolean {
  if (filter.messageTypes && !filter.messageTypes.includes(msg.message.type)) {
    return false;
  }
  if (filter.senderAddress && msg.senderAddress !== filter.senderAddress) {
    return false;
  }
  if (filter.minConfirmations && msg.confirmations < filter.minConfirmations) {
    return false;
  }
  if (filter.fromBlock && msg.blockHeight && msg.blockHeight < filter.fromBlock) {
    return false;
  }
  return true;
}

/**
 * Scan transactions sent to an address for QP messages.
 */
export async function scanAddress(
  provider: DogeApiProvider,
  address: string,
  limit: number = 50,
  filter?: ScanFilter
): Promise<OnChainQPMessage[]> {
  const txs = await provider.getTransactions(address, limit);
  const results: OnChainQPMessage[] = [];

  for (const tx of txs) {
    const msg = decodeQPFromTx(tx);
    if (!msg) continue;
    if (filter && !matchesFilter(msg, filter)) continue;
    results.push(msg);
  }

  return results;
}

/**
 * Scan a single transaction by txid for QP messages.
 */
export async function scanTransaction(
  provider: DogeApiProvider,
  txid: string
): Promise<OnChainQPMessage | null> {
  const tx = await provider.getTransaction(txid);
  return decodeQPFromTx(tx);
}
