/**
 * Reputation System unit tests — trust scores, tiers, sybil resistance.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeTrustScore,
  determineTier,
  determineEffectiveTier,
  computeReputation,
  meetsMinPaymentThreshold,
  paymentWeightedRating,
  selfPaymentSuspicion,
  DEFAULT_WEIGHTS,
  DEFAULT_CAPS,
  TIER_DEFINITIONS,
} from "../dist/src/qp/reputation/score.js";

import type { ReputationMetrics } from "../dist/src/qp/reputation/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides?: Partial<ReputationMetrics>): ReputationMetrics {
  return {
    totalRatings: 0,
    averageRating: 0,
    totalEarnedKoinu: 0,
    uniqueClients: 0,
    totalServices: 0,
    accountAgeBlocks: 0,
    disputeCount: 0,
    ...overrides,
  };
}

// =========================================================================
// 1. Trust Score Computation
// =========================================================================

describe("Trust Score", () => {
  it("brand new agent scores 0", () => {
    const score = computeTrustScore(makeMetrics());
    assert.equal(score, 0);
  });

  it("perfect agent scores high", () => {
    const score = computeTrustScore(makeMetrics({
      totalRatings: 100,
      averageRating: 5.0,
      totalEarnedKoinu: 1_000_000_000_000, // 10K DOGE
      uniqueClients: 50,
      totalServices: 100,
      accountAgeBlocks: 43_200,
      disputeCount: 0,
    }));
    // Should be close to 950 (0.95 * 1000)
    assert.ok(score >= 900);
    assert.ok(score <= 1000);
  });

  it("disputes reduce score", () => {
    const base = makeMetrics({
      totalRatings: 50,
      averageRating: 4.0,
      totalEarnedKoinu: 500_000_000_000,
      uniqueClients: 25,
      totalServices: 50,
      accountAgeBlocks: 20_000,
    });
    const clean = computeTrustScore({ ...base, disputeCount: 0 });
    const disputed = computeTrustScore({ ...base, disputeCount: 5 });
    assert.ok(clean > disputed);
  });

  it("score is clamped to 0-1000", () => {
    // Even with extreme values
    const high = computeTrustScore(makeMetrics({
      totalRatings: 1000,
      averageRating: 5.0,
      totalEarnedKoinu: 100_000_000_000_000,
      uniqueClients: 500,
      totalServices: 1000,
      accountAgeBlocks: 1_000_000,
    }));
    assert.ok(high >= 0 && high <= 1000);

    // All disputes
    const low = computeTrustScore(makeMetrics({
      totalRatings: 10,
      averageRating: 1.0,
      totalServices: 10,
      disputeCount: 10,
    }));
    assert.ok(low >= 0 && low <= 1000);
  });

  it("no ratings → rating component is 0", () => {
    const score = computeTrustScore(makeMetrics({
      totalRatings: 0,
      averageRating: 0,
      totalEarnedKoinu: 500_000_000_000,
      uniqueClients: 20,
      totalServices: 30,
      accountAgeBlocks: 10_000,
    }));
    // Should still get some score from volume, diversity, success, age
    assert.ok(score > 0);
    assert.ok(score < 700); // But not super high without ratings
  });

  it("custom weights are respected", () => {
    const metrics = makeMetrics({
      totalRatings: 50,
      averageRating: 5.0,
      uniqueClients: 0, // No diversity
      totalServices: 50,
      accountAgeBlocks: 43_200,
    });
    // Default weights give diversity 0.20 weight
    const defaultScore = computeTrustScore(metrics);

    // Custom weights: zero diversity weight
    const customScore = computeTrustScore(metrics, {
      ...DEFAULT_WEIGHTS,
      diversity: 0,
      rating: 0.50, // shift weight to rating
    });
    assert.ok(customScore > defaultScore);
  });
});

// =========================================================================
// 2. Tier Determination
// =========================================================================

describe("Tier Determination", () => {
  it("score 0 → new", () => {
    const tier = determineTier(0, makeMetrics());
    assert.equal(tier, "new");
  });

  it("score 50 → new", () => {
    assert.equal(determineTier(50, makeMetrics()), "new");
  });

  it("score 200 with enough ratings → emerging", () => {
    const tier = determineTier(200, makeMetrics({
      totalRatings: 10,
      uniqueClients: 5,
    }));
    assert.equal(tier, "emerging");
  });

  it("score 200 without enough ratings → new (requirements not met)", () => {
    const tier = determineTier(200, makeMetrics({
      totalRatings: 2, // < 5 required
      uniqueClients: 1,
    }));
    assert.equal(tier, "new");
  });

  it("score 500 with enough metrics → established", () => {
    const tier = determineTier(500, makeMetrics({
      totalRatings: 25,
      uniqueClients: 15,
    }));
    assert.equal(tier, "established");
  });

  it("score 700 with enough metrics → trusted", () => {
    const tier = determineTier(700, makeMetrics({
      totalRatings: 60,
      uniqueClients: 30,
      averageRating: 4.0,
    }));
    assert.equal(tier, "trusted");
  });

  it("score 900 with all requirements → elite", () => {
    const tier = determineTier(900, makeMetrics({
      totalRatings: 150,
      uniqueClients: 60,
      averageRating: 4.5,
    }));
    assert.equal(tier, "elite");
  });

  it("elite score but not enough clients → falls back", () => {
    // determineEffectiveTier should find highest qualifying tier
    const tier = determineEffectiveTier(900, makeMetrics({
      totalRatings: 150,
      uniqueClients: 5, // Only meets emerging (3)
      averageRating: 4.5,
    }));
    // Won't qualify for elite (50 clients), trusted (25), or established (10)
    // Qualifies for emerging (3 clients, 5 ratings)
    assert.equal(tier, "emerging");
  });
});

// =========================================================================
// 3. Tier Definitions
// =========================================================================

describe("Tier Definitions", () => {
  it("all tiers have icons", () => {
    for (const [tier, def] of Object.entries(TIER_DEFINITIONS)) {
      assert.ok(def.icon.length > 0, `${tier} missing icon`);
    }
  });

  it("tier ranges are contiguous", () => {
    assert.equal(TIER_DEFINITIONS.new.minScore, 0);
    assert.equal(TIER_DEFINITIONS.new.maxScore, 99);
    assert.equal(TIER_DEFINITIONS.emerging.minScore, 100);
    assert.equal(TIER_DEFINITIONS.emerging.maxScore, 299);
    assert.equal(TIER_DEFINITIONS.established.minScore, 300);
    assert.equal(TIER_DEFINITIONS.elite.maxScore, 1000);
  });

  it("icons match spec", () => {
    assert.equal(TIER_DEFINITIONS.new.icon, "🥚");
    assert.equal(TIER_DEFINITIONS.emerging.icon, "🐣");
    assert.equal(TIER_DEFINITIONS.established.icon, "🐥");
    assert.equal(TIER_DEFINITIONS.trusted.icon, "🦆");
    assert.equal(TIER_DEFINITIONS.elite.icon, "🦅");
  });
});

// =========================================================================
// 4. computeReputation (end-to-end)
// =========================================================================

describe("computeReputation", () => {
  it("returns full ReputationScore", () => {
    const rep = computeReputation(makeMetrics({
      totalRatings: 30,
      averageRating: 4.0,
      totalEarnedKoinu: 200_000_000_000,
      uniqueClients: 15,
      totalServices: 30,
      accountAgeBlocks: 20_000,
    }));
    assert.ok(rep.trustScore > 0);
    assert.ok(rep.tier);
    assert.ok(rep.tierIcon);
    assert.equal(rep.totalRatings, 30);
    assert.equal(rep.averageRating, 4.0);
  });

  it("new agent gets tier 'new' with egg icon", () => {
    const rep = computeReputation(makeMetrics());
    assert.equal(rep.tier, "new");
    assert.equal(rep.tierIcon, "🥚");
    assert.equal(rep.trustScore, 0);
  });
});

// =========================================================================
// 5. Payment Threshold & Weighted Rating
// =========================================================================

describe("Payment Threshold", () => {
  it("1 DOGE meets threshold", () => {
    assert.ok(meetsMinPaymentThreshold(100_000_000));
  });

  it("0.5 DOGE does not meet threshold", () => {
    assert.equal(meetsMinPaymentThreshold(50_000_000), false);
  });

  it("0 does not meet threshold", () => {
    assert.equal(meetsMinPaymentThreshold(0), false);
  });
});

describe("Payment-Weighted Rating", () => {
  it("weights higher payments more", () => {
    const ratings = [
      { rating: 5, paymentKoinu: 1_000_000_000 }, // 10 DOGE, rated 5
      { rating: 1, paymentKoinu: 100_000_000 },    // 1 DOGE, rated 1
    ];
    const weighted = paymentWeightedRating(ratings);
    // 10 DOGE payment should dominate → closer to 5 than 1
    assert.ok(weighted > 3.5);
  });

  it("excludes sub-threshold payments", () => {
    const ratings = [
      { rating: 1, paymentKoinu: 10_000_000 },  // 0.1 DOGE — below threshold
      { rating: 5, paymentKoinu: 500_000_000 },  // 5 DOGE — above threshold
    ];
    const weighted = paymentWeightedRating(ratings);
    // Only the 5-star rating counts
    assert.equal(weighted, 5);
  });

  it("returns 0 for no eligible ratings", () => {
    assert.equal(paymentWeightedRating([]), 0);
    assert.equal(paymentWeightedRating([
      { rating: 0, paymentKoinu: 500_000_000 }, // rating=0 excluded
    ]), 0);
  });
});

// =========================================================================
// 6. Sybil Detection
// =========================================================================

describe("Sybil Detection", () => {
  it("diverse payments → low suspicion", () => {
    const score = selfPaymentSuspicion({
      senderUniquePayments: 20,
      totalPayments: 20,
      sameAddressRatio: 0.05,
    });
    assert.ok(score < 0.1);
  });

  it("concentrated payments → high suspicion", () => {
    const score = selfPaymentSuspicion({
      senderUniquePayments: 1,
      totalPayments: 20,
      sameAddressRatio: 0.95,
    });
    assert.ok(score > 0.7);
  });

  it("suspicion capped at 1", () => {
    const score = selfPaymentSuspicion({
      senderUniquePayments: 1,
      totalPayments: 100,
      sameAddressRatio: 1.0,
    });
    assert.ok(score <= 1);
  });
});
