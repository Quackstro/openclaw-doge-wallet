/**
 * OP_RETURN Scanner
 * Scans Dogecoin transactions for QP protocol messages
 */
import type { DogeApiProvider, Transaction as ChainTx } from '../../types.js';
import type { OnChainQPMessage, ScanFilter } from './types.js';
/**
 * Extract all OP_RETURN data from a transaction's outputs.
 * Returns array of data buffers (one per OP_RETURN output).
 */
export declare function extractAllOpReturns(tx: ChainTx): Buffer[];
/**
 * Extract first OP_RETURN data from a transaction's outputs.
 * For backwards compatibility — returns first match or null.
 *
 * BlockCypher returns the output script hex. OP_RETURN scripts start with 0x6a
 * followed by a push opcode + data.
 */
export declare function extractOpReturn(tx: ChainTx): Buffer | null;
/**
 * Try to decode a QP message from a transaction.
 * Returns null if the tx has no QP OP_RETURN.
 */
export declare function decodeQPFromTx(tx: ChainTx): OnChainQPMessage | null;
/**
 * Scan transactions sent to an address for QP messages.
 */
export declare function scanAddress(provider: DogeApiProvider, address: string, limit?: number, filter?: ScanFilter): Promise<OnChainQPMessage[]>;
/**
 * Scan a single transaction by txid for QP messages.
 */
export declare function scanTransaction(provider: DogeApiProvider, txid: string): Promise<OnChainQPMessage | null>;
//# sourceMappingURL=scanner.d.ts.map