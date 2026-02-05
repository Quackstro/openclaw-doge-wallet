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
import { InsufficientFundsError } from "../errors.js";
// ============================================================================
// Constants
// ============================================================================
/** Estimated size of a single P2PKH input in bytes */
const INPUT_SIZE = 148;
/** Estimated size of a single P2PKH output in bytes */
const OUTPUT_SIZE = 34;
/** Base transaction overhead in bytes */
const TX_OVERHEAD = 10;
/** Dust threshold in koinu */
const DUST_THRESHOLD = 100_000; // 0.001 DOGE
// ============================================================================
// Builder
// ============================================================================
/**
 * Build an unsigned transaction.
 *
 * @param params - Transaction parameters
 * @returns BuildTransactionResult with raw tx hex, txid, fee, and output details
 * @throws Error if inputs are insufficient, amounts are invalid, etc.
 */
export function buildTransaction(params) {
    const { from, to, amount, utxos, changeAddress, feeRate, opReturnData, } = params;
    // Validation
    if (amount <= 0) {
        throw new Error("Transaction amount must be positive");
    }
    if (amount < DUST_THRESHOLD) {
        throw new Error(`Transaction amount ${amount} koinu is below dust threshold (${DUST_THRESHOLD} koinu)`);
    }
    if (utxos.length === 0) {
        throw new Error("No UTXOs provided for transaction inputs");
    }
    if (feeRate <= 0) {
        throw new Error("Fee rate must be positive");
    }
    // Import bitcore-lib-doge
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bitcore = require("bitcore-lib-doge");
    const { Transaction, PrivateKey, Script } = bitcore;
    // Calculate number of outputs: 1 (recipient) + optional change + optional OP_RETURN
    const totalInput = utxos.reduce((sum, u) => sum + u.amount, 0);
    const hasOpReturn = !!opReturnData;
    const baseOutputs = hasOpReturn ? 2 : 1; // recipient + optional OP_RETURN
    // Estimate fee with change output
    const feeWithChange = estimateFeeForTx(utxos.length, baseOutputs + 1, feeRate);
    const feeWithoutChange = estimateFeeForTx(utxos.length, baseOutputs, feeRate);
    const changeAmount = totalInput - amount - feeWithChange;
    let actualFee;
    let hasChange;
    if (changeAmount >= DUST_THRESHOLD) {
        // Normal case: create change output
        actualFee = feeWithChange;
        hasChange = true;
    }
    else if (changeAmount >= 0) {
        // Change below dust — absorb into fee
        actualFee = totalInput - amount;
        hasChange = false;
    }
    else {
        // Try without change output
        const remaining = totalInput - amount - feeWithoutChange;
        if (remaining >= 0) {
            actualFee = totalInput - amount;
            hasChange = false;
        }
        else {
            throw new InsufficientFundsError("Insufficient funds for this transaction");
        }
    }
    // Build UnspentOutput objects for bitcore
    // NOTE: If scriptPubKey is empty (some API providers don't return it),
    // generate the P2PKH script from the address.
    const unspentOutputs = utxos.map((u) => {
        let script = u.scriptPubKey;
        if (!script || script.length === 0) {
            // Generate P2PKH script from address
            const addr = new bitcore.Address(u.address);
            script = bitcore.Script.buildPublicKeyHashOut(addr).toHex();
        }
        return new Transaction.UnspentOutput({
            address: u.address,
            txId: u.txid,
            outputIndex: u.vout,
            script: script,
            satoshis: u.amount,
        });
    });
    // Construct the transaction
    const tx = new Transaction()
        .from(unspentOutputs)
        .to(to, amount)
        .fee(actualFee);
    // Add change output if needed
    if (hasChange) {
        tx.change(changeAddress ?? from);
    }
    // Add OP_RETURN output if data provided
    if (opReturnData) {
        tx.addData(opReturnData);
    }
    // Serialize without signing (unsigned)
    // Use uncheckedSerialize to skip the "not fully signed" check
    const rawTx = tx.uncheckedSerialize();
    // Build output details
    const outputs = [];
    // Recipient output
    outputs.push({
        address: to,
        amount,
        isChange: false,
        isOpReturn: false,
    });
    // Change output
    if (hasChange) {
        outputs.push({
            address: changeAddress ?? from,
            amount: changeAmount,
            isChange: true,
            isOpReturn: false,
        });
    }
    // OP_RETURN output
    if (opReturnData) {
        outputs.push({
            address: "OP_RETURN",
            amount: 0,
            isChange: false,
            isOpReturn: true,
        });
    }
    return {
        rawTx,
        txid: tx.hash,
        fee: actualFee,
        inputs: utxos,
        outputs,
        totalInput,
        totalOutput: amount + (hasChange ? changeAmount : 0),
    };
}
/**
 * Estimate the fee for a transaction given the input/output count and fee rate.
 */
function estimateFeeForTx(numInputs, numOutputs, feePerByte) {
    const txSize = TX_OVERHEAD + numInputs * INPUT_SIZE + numOutputs * OUTPUT_SIZE;
    return Math.ceil(txSize * feePerByte);
}
//# sourceMappingURL=builder.js.map