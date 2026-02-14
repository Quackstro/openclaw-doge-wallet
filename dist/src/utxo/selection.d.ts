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
import type { UTXO, CoinSelectionResult } from "../types.js";
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
export declare function selectCoins(utxos: UTXO[], targetAmount: number, feePerByte: number): CoinSelectionResult;
//# sourceMappingURL=selection.d.ts.map