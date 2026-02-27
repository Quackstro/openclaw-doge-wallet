/**
 * Reputation System Types
 * On-chain reputation computation for Quackstro Protocol agents
 */

/** Raw on-chain metrics for an agent */
export interface ReputationMetrics {
  /** Count of RATING/PAYMENT_COMPLETE with rating > 0 */
  totalRatings: number;
  /** Mean rating (1-5 scale) */
  averageRating: number;
  /** Total DOGE earned as provider (in koinu) */
  totalEarnedKoinu: number;
  /** Distinct addresses that paid this agent */
  uniqueClients: number;
  /** Count of DELIVERY_RECEIPT sent */
  totalServices: number;
  /** Blocks since first QP transaction */
  accountAgeBlocks: number;
  /** Ratings with dispute flag set */
  disputeCount: number;
}

/** Computed reputation score */
export interface ReputationScore extends ReputationMetrics {
  /** Composite trust score (0-1000) */
  trustScore: number;
  /** Reputation tier */
  tier: ReputationTier;
  /** Tier icon */
  tierIcon: string;
}

/** Reputation tiers (§10.5) */
export type ReputationTier = 'new' | 'emerging' | 'established' | 'trusted' | 'elite';

/** Tier thresholds and requirements */
export interface TierRequirements {
  minScore: number;
  maxScore: number;
  icon: string;
  minRatings?: number;
  minUniqueClients?: number;
  minAvgRating?: number;
}

/** Weight configuration for trust score computation */
export interface ScoreWeights {
  /** Average rating weight (default 0.30) */
  rating: number;
  /** Total volume weight (default 0.20) */
  volume: number;
  /** Client diversity weight (default 0.20) */
  diversity: number;
  /** Delivery success rate weight (default 0.15) */
  success: number;
  /** Account age weight (default 0.10) */
  age: number;
  /** Dispute penalty weight (default 0.05) */
  dispute: number;
}

/** Normalization caps */
export interface NormalizationCaps {
  /** Max DOGE earned for full volume score (default 10000 DOGE in koinu) */
  maxVolumeKoinu: number;
  /** Max unique clients for full diversity score (default 50) */
  maxClients: number;
  /** Max account age in blocks for full age score (default 43200 = ~30 days) */
  maxAgeBlocks: number;
  /** Max disputes before full penalty (default 10) */
  maxDisputes: number;
}
