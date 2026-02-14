/**
 * DOGE Wallet — UTXO Consolidation Analysis
 *
 * Analyzes the UTXO set and recommends consolidation when there are
 * too many small UTXOs that increase transaction costs.
 *
 * Much consolidate. Very efficient. Wow. 🐕
 */
import type { UTXO, ConsolidationRecommendation } from "../types.js";
export interface UtxoSummary {
    total: number;
    confirmed: number;
    unconfirmed: number;
    locked: number;
    dust: number;
    sizes: {
        small: number;
        medium: number;
        large: number;
    };
}
/**
 * Get a summary of the UTXO set.
 */
export declare function getUtxoSummary(utxos: UTXO[]): UtxoSummary;
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
export declare function shouldConsolidate(utxos: UTXO[]): ConsolidationRecommendation;
//# sourceMappingURL=consolidation.d.ts.map