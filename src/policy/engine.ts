/**
 * DOGE Wallet — Spending Policy Engine
 *
 * The heart of autonomous operation — evaluates whether a send is allowed
 * based on configurable spending tiers, rate limits, allowlist/denylist,
 * freeze flag, and cooldown periods.
 *
 * Much policy. Very tier. Wow. 🐕
 */

import type { PolicyConfig } from "../types.js";
import { dogeToKoinu, koinuToDoge, KOINU_PER_DOGE } from "../types.js";
import type { LimitTracker } from "./limits.js";

// ============================================================================
// Types
// ============================================================================

export type SpendAction = "auto" | "notify" | "delay" | "approve" | "confirm-code" | "deny";
export type TierName = "micro" | "small" | "medium" | "large" | "sweep";

export interface PolicyEvaluation {
  /** Whether the spend is allowed (or needs approval) */
  allowed: boolean;
  /** Which tier the amount falls into */
  tier: TierName;
  /** What action should be taken */
  action: SpendAction;
  /** Human-readable reason for the decision */
  reason?: string;
  /** Delay in minutes before auto-approval (for "delay" action) */
  delayMinutes?: number;
}

// ============================================================================
// Policy Engine
// ============================================================================

export class PolicyEngine {
  private readonly config: PolicyConfig;
  private readonly limits: LimitTracker;
  private frozen: boolean;

  constructor(config: PolicyConfig, limits: LimitTracker) {
    this.config = config;
    this.limits = limits;
    this.frozen = config.freeze;
  }

  /**
   * Evaluate whether a spend is allowed under the current policy.
   *
   * @param amountDoge - Amount in DOGE
   * @param recipient - Recipient DOGE address
   * @param _reason - Reason for the spend (for audit)
   * @returns PolicyEvaluation with decision
   */
  evaluate(amountDoge: number, recipient: string, _reason?: string): PolicyEvaluation {
    // Check if policy is even enabled
    if (!this.config.enabled) {
      return {
        allowed: true,
        tier: this.determineTier(amountDoge),
        action: "auto",
        reason: "Spending policy disabled — auto-approved",
      };
    }

    // Check freeze flag
    if (this.frozen) {
      return {
        allowed: false,
        tier: this.determineTier(amountDoge),
        action: "deny",
        reason: "🧊 Wallet is FROZEN — all sends blocked. Use /wallet unfreeze to resume.",
      };
    }

    // Check denylist
    if (this.config.denylist.includes(recipient)) {
      return {
        allowed: false,
        tier: this.determineTier(amountDoge),
        action: "deny",
        reason: `Address ${recipient} is on the denylist — send blocked.`,
      };
    }

    // Check rate limits
    const amountKoinu = dogeToKoinu(amountDoge);
    const limitsCheck = this.limits.isWithinLimits(amountKoinu);
    if (!limitsCheck.withinLimits) {
      return {
        allowed: false,
        tier: this.determineTier(amountDoge),
        action: "deny",
        reason: limitsCheck.reason ?? "Rate limit exceeded",
      };
    }

    // Check cooldown
    const cooldownOk = this.limits.checkCooldown(this.config.limits.cooldownSeconds);
    if (!cooldownOk) {
      return {
        allowed: false,
        tier: this.determineTier(amountDoge),
        action: "deny",
        reason: `Cooldown active — minimum ${this.config.limits.cooldownSeconds}s between sends.`,
      };
    }

    // Check allowlist (skip tier check for pre-approved addresses)
    if (this.config.allowlist.includes(recipient)) {
      return {
        allowed: true,
        tier: this.determineTier(amountDoge),
        action: "auto",
        reason: `Address ${recipient} is on the allowlist — auto-approved.`,
      };
    }

    // Determine tier and action
    const tier = this.determineTier(amountDoge);
    return this.evaluateTier(tier, amountDoge);
  }

  /**
   * Determines the spending tier for a given amount.
   * Tier boundaries are INCLUSIVE (<=).
   * Example: If micro.maxAmount=10, then 10.0 DOGE falls into "micro" tier.
   *          10.00000001 DOGE would fall into "small" tier.
   */
  determineTier(amountDoge: number): TierName {
    const { tiers } = this.config;
    if (amountDoge <= (tiers.micro.maxAmount ?? 0)) return "micro";
    if (amountDoge <= (tiers.small.maxAmount ?? 0)) return "small";
    if (amountDoge <= (tiers.medium.maxAmount ?? 0)) return "medium";
    if (amountDoge <= (tiers.large.maxAmount ?? 0)) return "large";
    return "sweep";
  }

  /**
   * Evaluate the action for a specific tier.
   */
  private evaluateTier(tier: TierName, amountDoge: number): PolicyEvaluation {
    const tierConfig = this.config.tiers[tier];

    switch (tierConfig.approval) {
      case "auto":
        return {
          allowed: true,
          tier,
          action: "auto",
          reason: `Tier: ${tier} (≤${tierConfig.maxAmount ?? "∞"} DOGE) — auto-approved, log only.`,
        };

      case "auto-logged":
        return {
          allowed: true,
          tier,
          action: "notify",
          reason: `Tier: ${tier} (≤${tierConfig.maxAmount ?? "∞"} DOGE) — auto-approved, logged + notified.`,
        };

      case "notify-delay":
        return {
          allowed: false,
          tier,
          action: "delay",
          reason:
            `Tier: ${tier} (${amountDoge} DOGE) — notification sent. ` +
            `Auto-approves in ${tierConfig.delayMinutes ?? 5} minutes unless denied.`,
          delayMinutes: tierConfig.delayMinutes ?? 5,
        };

      case "owner-required":
        return {
          allowed: false,
          tier,
          action: "approve",
          reason: `Tier: ${tier} (${amountDoge} DOGE) — owner approval required.`,
        };

      case "owner-confirm-code":
        return {
          allowed: false,
          tier,
          action: "confirm-code",
          reason: `Tier: ${tier} (${amountDoge} DOGE) — owner confirmation code required. Much large. Very careful.`,
        };

      default:
        return {
          allowed: false,
          tier,
          action: "deny",
          reason: `Unknown approval type for tier ${tier} — denied for safety.`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // Freeze / Unfreeze
  // --------------------------------------------------------------------------

  freeze(): void {
    this.frozen = true;
  }

  unfreeze(): void {
    this.frozen = false;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  // --------------------------------------------------------------------------
  // Config access
  // --------------------------------------------------------------------------

  getConfig(): PolicyConfig {
    return this.config;
  }
}
