/**
 * Reputation Score Computation
 * Trust score algorithm from spec §10.4
 */
import type { ReputationMetrics, ReputationScore, ReputationTier, TierRequirements, ScoreWeights, NormalizationCaps } from './types.js';
/** Default weight factors (§10.4) */
export declare const DEFAULT_WEIGHTS: ScoreWeights;
/** Default normalization caps */
export declare const DEFAULT_CAPS: NormalizationCaps;
/** Tier definitions (§10.5) */
export declare const TIER_DEFINITIONS: Record<ReputationTier, TierRequirements>;
/**
 * Compute the composite trust score (0-1000) from raw metrics.
 *
 * Formula (§10.4):
 *   score = (W_RATING * ratingNorm + W_VOLUME * volumeNorm +
 *            W_DIVERSITY * diversityNorm + W_SUCCESS * successNorm +
 *            W_AGE * ageNorm - W_DISPUTE * disputePenalty) * 1000
 */
export declare function computeTrustScore(metrics: ReputationMetrics, weights?: ScoreWeights, caps?: NormalizationCaps): number;
/**
 * Determine reputation tier from score and metrics.
 *
 * The tier is the highest tier whose score threshold AND
 * hard requirements (minRatings, minUniqueClients, minAvgRating) are met.
 */
export declare function determineTier(score: number, metrics: ReputationMetrics): ReputationTier;
/**
 * Get the highest tier the agent qualifies for, considering that
 * a high score alone isn't enough — hard requirements must be met.
 * If score qualifies for "trusted" but metrics only meet "emerging",
 * the agent is capped at "emerging".
 */
export declare function determineEffectiveTier(score: number, metrics: ReputationMetrics): ReputationTier;
/**
 * Compute the full ReputationScore from raw metrics.
 */
export declare function computeReputation(metrics: ReputationMetrics, weights?: ScoreWeights, caps?: NormalizationCaps): ReputationScore;
/**
 * Check if an agent meets the minimum payment threshold for
 * their rating to carry weight (§10.3: payments < 1 DOGE = zero weight).
 */
export declare function meetsMinPaymentThreshold(paymentKoinu: number): boolean;
/**
 * Compute payment-weighted average rating.
 * Ratings backed by larger payments carry more weight (§10.3).
 */
export declare function paymentWeightedRating(ratings: Array<{
    rating: number;
    paymentKoinu: number;
}>): number;
/**
 * Detect potential self-payment (Sybil indicator).
 * Simple heuristic: flag if sender and receiver share common UTXO ancestry.
 * Returns a suspicion score (0-1).
 */
export declare function selfPaymentSuspicion(params: {
    senderUniquePayments: number;
    totalPayments: number;
    sameAddressRatio: number;
}): number;
//# sourceMappingURL=score.d.ts.map