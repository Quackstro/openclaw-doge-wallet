/**
 * OP_RETURN Scanner
 * Scans Dogecoin transactions for QP protocol messages
 */
import { decodeMessage, isQPMessage } from '../messages.js';
/**
 * Extract all OP_RETURN data from a transaction's outputs.
 * Returns array of data buffers (one per OP_RETURN output).
 */
export function extractAllOpReturns(tx) {
    const results = [];
    for (const out of tx.outputs) {
        const data = parseOpReturnOutput(out);
        if (data)
            results.push(data);
    }
    return results;
}
/**
 * Parse a single output for OP_RETURN data.
 */
function parseOpReturnOutput(out) {
    if (!out.script)
        return null;
    const isNullData = out.scriptType === 'null-data';
    const startsWithOpReturn = out.script.startsWith('6a');
    if (!isNullData && !startsWithOpReturn)
        return null;
    try {
        const scriptBuf = Buffer.from(out.script, 'hex');
        if (scriptBuf[0] !== 0x6a)
            return null;
        let dataStart;
        let dataLen;
        if (scriptBuf[1] <= 0x4b) {
            dataLen = scriptBuf[1];
            dataStart = 2;
        }
        else if (scriptBuf[1] === 0x4c) {
            dataLen = scriptBuf[2];
            dataStart = 3;
        }
        else if (scriptBuf[1] === 0x4d) {
            dataLen = scriptBuf.readUInt16LE(2);
            dataStart = 4;
        }
        else {
            return null;
        }
        if (dataStart + dataLen > scriptBuf.length)
            return null;
        return scriptBuf.subarray(dataStart, dataStart + dataLen);
    }
    catch {
        return null;
    }
}
/**
 * Extract first OP_RETURN data from a transaction's outputs.
 * For backwards compatibility — returns first match or null.
 *
 * BlockCypher returns the output script hex. OP_RETURN scripts start with 0x6a
 * followed by a push opcode + data.
 */
export function extractOpReturn(tx) {
    const all = extractAllOpReturns(tx);
    return all.length > 0 ? all[0] : null;
}
/**
 * Try to decode a QP message from a transaction.
 * Returns null if the tx has no QP OP_RETURN.
 */
export function decodeQPFromTx(tx) {
    const opReturnData = extractOpReturn(tx);
    if (!opReturnData || opReturnData.length < 4)
        return null;
    if (!isQPMessage(opReturnData))
        return null;
    let message;
    try {
        message = decodeMessage(opReturnData);
    }
    catch {
        return null; // Malformed QP message
    }
    // Sender = first input address
    const senderAddress = tx.inputs[0]?.address ?? 'unknown';
    // Recipient = first non-OP_RETURN output address
    let recipientAddress = 'unknown';
    let amountKoinu = 0;
    for (const out of tx.outputs) {
        if (out.scriptType === 'null-data')
            continue;
        if (out.script?.startsWith('6a'))
            continue;
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
function matchesFilter(msg, filter) {
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
export async function scanAddress(provider, address, limit = 50, filter) {
    const txs = await provider.getTransactions(address, limit);
    const results = [];
    for (const tx of txs) {
        const msg = decodeQPFromTx(tx);
        if (!msg)
            continue;
        if (filter && !matchesFilter(msg, filter))
            continue;
        results.push(msg);
    }
    return results;
}
/**
 * Scan a single transaction by txid for QP messages.
 */
export async function scanTransaction(provider, txid) {
    const tx = await provider.getTransaction(txid);
    return decodeQPFromTx(tx);
}
//# sourceMappingURL=scanner.js.map