/**
 * Reputation Score Computation
 * Trust score algorithm from spec §10.4
 */

import type {
  ReputationMetrics,
  ReputationScore,
  ReputationTier,
  TierRequirements,
  ScoreWeights,
  NormalizationCaps,
} from './types.js';

/** Default weight factors (§10.4) */
export const DEFAULT_WEIGHTS: ScoreWeights = {
  rating: 0.30,
  volume: 0.20,
  diversity: 0.20,
  success: 0.15,
  age: 0.10,
  dispute: 0.05,
};

/** Default normalization caps */
export const DEFAULT_CAPS: NormalizationCaps = {
  maxVolumeKoinu: 1_000_000_000_000, // 10,000 DOGE
  maxClients: 50,
  maxAgeBlocks: 43_200, // ~30 days at 1 block/min
  maxDisputes: 10,
};

/** Tier definitions (§10.5) */
export const TIER_DEFINITIONS: Record<ReputationTier, TierRequirements> = {
  new: { minScore: 0, maxScore: 99, icon: '🥚' },
  emerging: { minScore: 100, maxScore: 299, icon: '🐣', minRatings: 5, minUniqueClients: 3 },
  established: { minScore: 300, maxScore: 599, icon: '🐥', minRatings: 20, minUniqueClients: 10 },
  trusted: { minScore: 600, maxScore: 849, icon: '🦆', minRatings: 50, minUniqueClients: 25, minAvgRating: 3.5 },
  elite: { minScore: 850, maxScore: 1000, icon: '🦅', minRatings: 100, minUniqueClients: 50, minAvgRating: 4.0 },
};

/**
 * Compute the composite trust score (0-1000) from raw metrics.
 *
 * Formula (§10.4):
 *   score = (W_RATING * ratingNorm + W_VOLUME * volumeNorm +
 *            W_DIVERSITY * diversityNorm + W_SUCCESS * successNorm +
 *            W_AGE * ageNorm - W_DISPUTE * disputePenalty) * 1000
 */
export function computeTrustScore(
  metrics: ReputationMetrics,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  caps: NormalizationCaps = DEFAULT_CAPS
): number {
  // Normalize each factor to 0-1 range
  // Clamp totalEarnedKoinu to safe integer range to prevent precision loss
  const safeEarned = Math.min(metrics.totalEarnedKoinu, Number.MAX_SAFE_INTEGER);

  const ratingNorm = metrics.totalRatings > 0
    ? Math.max(0, Math.min(1, (metrics.averageRating - 1) / 4))
    : 0;

  const volumeNorm = Math.min(safeEarned / caps.maxVolumeKoinu, 1);
  const diversityNorm = Math.min(metrics.uniqueClients / caps.maxClients, 1);

  const successNorm = metrics.totalServices > 0
    ? Math.max(0, (metrics.totalServices - metrics.disputeCount) / metrics.totalServices)
    : 0;

  const ageNorm = Math.min(metrics.accountAgeBlocks / caps.maxAgeBlocks, 1);
  const disputePenalty = Math.min(metrics.disputeCount / caps.maxDisputes, 1);

  const raw = (
    weights.rating * ratingNorm +
    weights.volume * volumeNorm +
    weights.diversity * diversityNorm +
    weights.success * successNorm +
    weights.age * ageNorm -
    weights.dispute * disputePenalty
  );

  return Math.round(Math.max(0, Math.min(1, raw)) * 1000);
}

/**
 * Determine reputation tier from score and metrics.
 *
 * The tier is the highest tier whose score threshold AND
 * hard requirements (minRatings, minUniqueClients, minAvgRating) are met.
 */
export function determineTier(
  score: number,
  metrics: ReputationMetrics
): ReputationTier {
  const tiers: ReputationTier[] = ['elite', 'trusted', 'established', 'emerging', 'new'];

  for (const tier of tiers) {
    const req = TIER_DEFINITIONS[tier];
    if (score < req.minScore) continue;
    if (score > req.maxScore) continue;

    // Check hard requirements
    if (req.minRatings && metrics.totalRatings < req.minRatings) continue;
    if (req.minUniqueClients && metrics.uniqueClients < req.minUniqueClients) continue;
    if (req.minAvgRating && metrics.averageRating < req.minAvgRating) continue;

    return tier;
  }

  return 'new';
}

/**
 * Get the highest tier the agent qualifies for, considering that
 * a high score alone isn't enough — hard requirements must be met.
 * If score qualifies for "trusted" but metrics only meet "emerging",
 * the agent is capped at "emerging".
 */
export function determineEffectiveTier(
  score: number,
  metrics: ReputationMetrics
): ReputationTier {
  // Walk down from highest tier
  const orderedTiers: ReputationTier[] = ['elite', 'trusted', 'established', 'emerging', 'new'];

  for (const tier of orderedTiers) {
    const req = TIER_DEFINITIONS[tier];
    if (score < req.minScore) continue;

    // Check hard requirements
    const meetsRequirements =
      (!req.minRatings || metrics.totalRatings >= req.minRatings) &&
      (!req.minUniqueClients || metrics.uniqueClients >= req.minUniqueClients) &&
      (!req.minAvgRating || metrics.averageRating >= req.minAvgRating);

    if (meetsRequirements) return tier;
  }

  return 'new';
}

/**
 * Compute the full ReputationScore from raw metrics.
 */
export function computeReputation(
  metrics: ReputationMetrics,
  weights?: ScoreWeights,
  caps?: NormalizationCaps
): ReputationScore {
  const trustScore = computeTrustScore(metrics, weights, caps);
  const tier = determineEffectiveTier(trustScore, metrics);
  const tierIcon = TIER_DEFINITIONS[tier].icon;

  return {
    ...metrics,
    trustScore,
    tier,
    tierIcon,
  };
}

/**
 * Check if an agent meets the minimum payment threshold for
 * their rating to carry weight (§10.3: payments < 1 DOGE = zero weight).
 */
export function meetsMinPaymentThreshold(paymentKoinu: number): boolean {
  return paymentKoinu >= 100_000_000; // 1 DOGE
}

/**
 * Compute payment-weighted average rating.
 * Ratings backed by larger payments carry more weight (§10.3).
 */
export function paymentWeightedRating(
  ratings: Array<{ rating: number; paymentKoinu: number }>
): number {
  const eligible = ratings.filter(r => r.rating > 0 && meetsMinPaymentThreshold(r.paymentKoinu));
  if (eligible.length === 0) return 0;

  let totalWeight = 0;
  let weightedSum = 0;
  for (const r of eligible) {
    // Clamp rating to valid 1-5 range (on-chain data could be anything 0-255)
    const clampedRating = Math.max(1, Math.min(5, r.rating));
    const weight = r.paymentKoinu;
    weightedSum += clampedRating * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Detect potential self-payment (Sybil indicator).
 * Simple heuristic: flag if sender and receiver share common UTXO ancestry.
 * Returns a suspicion score (0-1).
 */
export function selfPaymentSuspicion(params: {
  senderUniquePayments: number;
  totalPayments: number;
  sameAddressRatio: number;
}): number {
  // If one sender accounts for a large ratio of payments, suspicious
  const concentrationScore = params.senderUniquePayments > 0
    ? 1 - (params.senderUniquePayments / params.totalPayments)
    : 0;

  // If many payments come from the same address
  const sameAddrScore = params.sameAddressRatio;

  return Math.min(1, (concentrationScore + sameAddrScore) / 2);
}
