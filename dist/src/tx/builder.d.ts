/**
 * DOGE Wallet — Transaction Builder
 *
 * Constructs unsigned P2PKH transactions using bitcore-lib-doge.
 * Handles inputs (from coin selection), outputs (recipient + change),
 * fee calculation, and optional OP_RETURN data.
 *
 * All amounts in koinu (1 DOGE = 100,000,000 koinu).
 *
 * Much build. Very transaction. Wow. 🐕
 */
import type { UTXO } from "../types.js";
export interface BuildTransactionParams {
    /** Sender's address (for change) */
    from: string;
    /** Recipient's address */
    to: string;
    /** Amount to send in koinu */
    amount: number;
    /** Selected UTXOs to use as inputs */
    utxos: UTXO[];
    /** Change address (defaults to `from`) */
    changeAddress?: string;
    /** Fee rate in koinu per byte */
    feeRate: number;
    /** Optional OP_RETURN data (e.g., for Quackstro Protocol invoice IDs) */
    opReturnData?: string;
    /** Maximum fee in koinu (safety cap — rejects tx if fee exceeds this) */
    maxFee?: number;
}
export interface TxOutput {
    address: string;
    amount: number;
    isChange: boolean;
    isOpReturn: boolean;
}
export interface BuildTransactionResult {
    /** Serialized unsigned transaction hex */
    rawTx: string;
    /** Transaction ID (hash) */
    txid: string;
    /** Fee in koinu */
    fee: number;
    /** Inputs used */
    inputs: UTXO[];
    /** Outputs created */
    outputs: TxOutput[];
    /** Total input value in koinu */
    totalInput: number;
    /** Total output value in koinu */
    totalOutput: number;
}
/**
 * Build an unsigned transaction.
 *
 * @param params - Transaction parameters
 * @returns BuildTransactionResult with raw tx hex, txid, fee, and output details
 * @throws Error if inputs are insufficient, amounts are invalid, etc.
 */
export declare function buildTransaction(params: BuildTransactionParams): BuildTransactionResult;
//# sourceMappingURL=builder.d.ts.map