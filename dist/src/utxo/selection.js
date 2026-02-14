/**
 * DOGE Wallet — Coin Selection
 *
 * Implements multiple coin selection strategies:
 * 1. Exact match — if any single UTXO matches the target + fee exactly
 * 2. Largest first — greedy fallback that picks largest UTXOs first
 *
 * All amounts in koinu (1 DOGE = 100,000,000 koinu).
 *
 * Much select. Very optimal. Wow. 🐕
 */
import { InsufficientFundsError } from "../errors.js";
/** Estimated size of a P2PKH input in bytes */
const INPUT_SIZE = 148;
/** Estimated size of a P2PKH output in bytes */
const OUTPUT_SIZE = 34;
/** Base transaction overhead in bytes */
const TX_OVERHEAD = 10;
/** Dust threshold in koinu (0.001 DOGE) */
const DUST_THRESHOLD = 100_000;
/**
 * Estimate the fee for a transaction given input/output count and fee rate.
 */
function estimateFee(numInputs, numOutputs, feePerByte) {
    const size = TX_OVERHEAD + numInputs * INPUT_SIZE + numOutputs * OUTPUT_SIZE;
    return Math.ceil(size * feePerByte);
}
/**
 * Try to find a single UTXO that exactly matches the target + fee
 * (or is close enough that the remainder is dust and can be absorbed).
 */
function tryExactMatch(utxos, target, feePerByte) {
    // Fee for 1 input, 1 output (no change)
    const fee = estimateFee(1, 1, feePerByte);
    for (const u of utxos) {
        const diff = u.amount - target - fee;
        // Accept if exact or the remainder is dust (absorbed into fee)
        if (diff >= 0 && diff < DUST_THRESHOLD) {
            return {
                selected: [u],
                totalInput: u.amount,
                fee: u.amount - target, // absorb dust remainder into fee
                change: 0,
                algorithm: "exact-match",
            };
        }
    }
    return null;
}
/**
 * Largest-first greedy coin selection.
 * Picks the largest UTXOs until the target + fee is met.
 */
function largestFirst(utxos, target, feePerByte) {
    const sorted = [...utxos].sort((a, b) => b.amount - a.amount);
    const selected = [];
    let totalInput = 0;
    for (const u of sorted) {
        selected.push(u);
        totalInput += u.amount;
        // Try with change output first (2 outputs: recipient + change)
        const feeWithChange = estimateFee(selected.length, 2, feePerByte);
        if (totalInput >= target + feeWithChange) {
            const change = totalInput - target - feeWithChange;
            if (change >= DUST_THRESHOLD) {
                return {
                    selected,
                    totalInput,
                    fee: feeWithChange,
                    change,
                    algorithm: "largest-first",
                };
            }
        }
        // If remainder is too small for change, absorb into fee
        const feeNoChange = estimateFee(selected.length, 1, feePerByte);
        if (totalInput >= target + feeNoChange) {
            return {
                selected,
                totalInput,
                fee: totalInput - target,
                change: 0,
                algorithm: "largest-first",
            };
        }
    }
    throw new InsufficientFundsError("Insufficient funds for this transaction");
}
/**
 * Select coins for a transaction.
 *
 * Tries strategies in order:
 * 1. Exact match (single UTXO, no change needed)
 * 2. Largest first (greedy)
 *
 * @param utxos - Available (unlocked, confirmed) UTXOs
 * @param targetAmount - Amount to send in koinu
 * @param feePerByte - Fee rate in koinu per byte
 * @returns CoinSelectionResult
 * @throws InsufficientFundsError if not enough funds
 */
export function selectCoins(utxos, targetAmount, feePerByte) {
    if (utxos.length === 0) {
        throw new InsufficientFundsError("No spendable UTXOs available");
    }
    // Strategy 1: Exact match
    const exact = tryExactMatch(utxos, targetAmount, feePerByte);
    if (exact)
        return exact;
    // Strategy 2: Largest first
    return largestFirst(utxos, targetAmount, feePerByte);
}
//# sourceMappingURL=selection.js.map