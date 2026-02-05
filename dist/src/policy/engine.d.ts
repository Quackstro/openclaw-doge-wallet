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
import type { LimitTracker } from "./limits.js";
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
export declare class PolicyEngine {
    private readonly config;
    private readonly limits;
    private frozen;
    constructor(config: PolicyConfig, limits: LimitTracker);
    /**
     * Evaluate whether a spend is allowed under the current policy.
     *
     * @param amountDoge - Amount in DOGE
     * @param recipient - Recipient DOGE address
     * @param _reason - Reason for the spend (for audit)
     * @returns PolicyEvaluation with decision
     */
    evaluate(amountDoge: number, recipient: string, _reason?: string): PolicyEvaluation;
    /**
     * Determines the spending tier for a given amount.
     * Tier boundaries are INCLUSIVE (<=).
     * Example: If micro.maxAmount=10, then 10.0 DOGE falls into "micro" tier.
     *          10.00000001 DOGE would fall into "small" tier.
     */
    determineTier(amountDoge: number): TierName;
    /**
     * Evaluate the action for a specific tier.
     */
    private evaluateTier;
    freeze(): void;
    unfreeze(): void;
    isFrozen(): boolean;
    getConfig(): PolicyConfig;
}
//# sourceMappingURL=engine.d.ts.map