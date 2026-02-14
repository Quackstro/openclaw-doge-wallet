/**
 * DOGE Wallet — UTXO Consolidation Analysis
 *
 * Analyzes the UTXO set and recommends consolidation when there are
 * too many small UTXOs that increase transaction costs.
 *
 * Much consolidate. Very efficient. Wow. 🐕
 */
import { KOINU_PER_DOGE } from "../types.js";
/** Estimated P2PKH input size in bytes */
const INPUT_SIZE = 148;
/** Estimated P2PKH output size in bytes */
const OUTPUT_SIZE = 34;
/** Base transaction overhead in bytes */
const TX_OVERHEAD = 10;
/** Default fee rate (koinu per byte) for estimation */
const DEFAULT_FEE_RATE = 100;
/** Dust threshold: UTXOs below this are considered dust (0.001 DOGE) */
const DUST_THRESHOLD = 100_000;
/** DOGE boundaries for size categorization */
const SMALL_THRESHOLD = 1 * KOINU_PER_DOGE; // < 1 DOGE
const LARGE_THRESHOLD = 100 * KOINU_PER_DOGE; // > 100 DOGE
/**
 * Get a summary of the UTXO set.
 */
export function getUtxoSummary(utxos) {
    let confirmed = 0;
    let unconfirmed = 0;
    let locked = 0;
    let dust = 0;
    let small = 0;
    let medium = 0;
    let large = 0;
    for (const u of utxos) {
        if (u.locked)
            locked++;
        else if (u.confirmations >= 1)
            confirmed++;
        else
            unconfirmed++;
        if (u.amount < DUST_THRESHOLD)
            dust++;
        if (u.amount < SMALL_THRESHOLD)
            small++;
        else if (u.amount > LARGE_THRESHOLD)
            large++;
        else
            medium++;
    }
    return {
        total: utxos.length,
        confirmed,
        unconfirmed,
        locked,
        dust,
        sizes: { small, medium, large },
    };
}
/**
 * Estimate consolidation fee (many inputs → 1 output).
 */
function estimateConsolidationFee(inputCount) {
    const size = TX_OVERHEAD + inputCount * INPUT_SIZE + OUTPUT_SIZE;
    return Math.ceil(size * DEFAULT_FEE_RATE);
}
/**
 * Analyze UTXOs and recommend whether consolidation is needed.
 *
 * Recommends consolidation when:
 * - More than 50 spendable UTXOs
 * - 10+ dust UTXOs worth more than 2x the consolidation fee
 *
 * @param utxos - Current UTXO set
 * @returns ConsolidationRecommendation
 */
export function shouldConsolidate(utxos) {
    const spendable = utxos.filter((u) => !u.locked && u.confirmations >= 1);
    const dustUtxos = spendable.filter((u) => u.amount < DUST_THRESHOLD);
    if (spendable.length === 0) {
        return {
            shouldConsolidate: false,
            reason: "No spendable UTXOs to consolidate.",
            utxoCount: utxos.length,
            dustCount: 0,
            estimatedFee: 0,
            consolidateCount: 0,
        };
    }
    // Case 1: Too many UTXOs overall
    if (spendable.length > 50) {
        const fee = estimateConsolidationFee(spendable.length);
        return {
            shouldConsolidate: true,
            reason: `${spendable.length} UTXOs — consolidation would reduce future tx fees.`,
            utxoCount: utxos.length,
            dustCount: dustUtxos.length,
            estimatedFee: fee,
            consolidateCount: spendable.length,
        };
    }
    // Case 2: Many dust UTXOs
    if (dustUtxos.length >= 10) {
        const fee = estimateConsolidationFee(dustUtxos.length);
        const dustTotal = dustUtxos.reduce((sum, u) => sum + u.amount, 0);
        // Only recommend if the dust value exceeds the consolidation fee
        if (dustTotal > fee * 2) {
            return {
                shouldConsolidate: true,
                reason: `${dustUtxos.length} dust UTXOs worth consolidating.`,
                utxoCount: utxos.length,
                dustCount: dustUtxos.length,
                estimatedFee: fee,
                consolidateCount: dustUtxos.length,
            };
        }
    }
    return {
        shouldConsolidate: false,
        reason: `UTXO set looks healthy (${spendable.length} spendable).`,
        utxoCount: utxos.length,
        dustCount: dustUtxos.length,
        estimatedFee: 0,
        consolidateCount: 0,
    };
}
//# sourceMappingURL=consolidation.js.map