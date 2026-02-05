/**
 * DOGE Wallet — Mainnet Configuration
 *
 * Production-ready defaults and safety checks for mainnet deployment.
 * These are conservative settings that prioritize security over convenience.
 *
 * Much mainnet. Very production. Wow. 🐕
 */
// ============================================================================
// Mainnet Constants
// ============================================================================
/** Mainnet minimum confirmations (6 blocks ≈ 6 minutes) */
export const MAINNET_MIN_CONFIRMATIONS = 6;
/** Testnet minimum confirmations (1 block for faster testing) */
export const TESTNET_MIN_CONFIRMATIONS = 1;
/** Mainnet dust threshold in koinu (0.01 DOGE - more conservative than protocol minimum) */
export const MAINNET_DUST_THRESHOLD = 1_000_000;
/** Testnet dust threshold in koinu (0.001 DOGE - lower for testing) */
export const TESTNET_DUST_THRESHOLD = 100_000;
/** Mainnet daily limit warning threshold (DOGE) */
export const MAINNET_DAILY_LIMIT_WARNING = 1000;
/** Maximum recommended daily limit for automated operations (DOGE) */
export const MAINNET_RECOMMENDED_DAILY_MAX = 5000;
/** Minimum fee rate for mainnet (koinu/byte) - ensures timely confirmation */
export const MAINNET_MIN_FEE_RATE = 1000;
/** Default fee strategy for mainnet */
export const MAINNET_DEFAULT_FEE_STRATEGY = "medium";
/** Mainnet recommended cooldown between sends (seconds) */
export const MAINNET_COOLDOWN_SECONDS = 30;
/** Testnet cooldown (faster for testing) */
export const TESTNET_COOLDOWN_SECONDS = 5;
// ============================================================================
// Mainnet Policy Defaults
// ============================================================================
/**
 * Conservative policy defaults for mainnet.
 * These settings require more approval and have stricter limits.
 */
export const MAINNET_POLICY_DEFAULTS = {
    enabled: true,
    tiers: {
        // Micro: Up to 1 DOGE - auto-approved, logged only
        micro: { maxAmount: 1, approval: "auto-logged" },
        // Small: Up to 10 DOGE - auto-approved with notification
        small: { maxAmount: 10, approval: "auto-logged" },
        // Medium: Up to 100 DOGE - requires delay, can be cancelled
        medium: { maxAmount: 100, approval: "notify-delay", delayMinutes: 5 },
        // Large: Up to 1000 DOGE - requires owner approval
        large: { maxAmount: 1000, approval: "owner-required" },
        // Sweep: Above 1000 DOGE - requires confirmation code
        sweep: { maxAmount: null, approval: "owner-confirm-code" },
    },
    limits: {
        dailyMax: 5000, // 5000 DOGE per day max
        hourlyMax: 1000, // 1000 DOGE per hour max  
        txCountDailyMax: 50, // Max 50 transactions per day
        cooldownSeconds: 30, // 30 second minimum between sends
    },
    allowlist: [], // No pre-approved addresses by default
    denylist: [],
    freeze: false,
};
/**
 * More permissive policy for testnet (faster iteration).
 */
export const TESTNET_POLICY_DEFAULTS = {
    enabled: true,
    tiers: {
        micro: { maxAmount: 100, approval: "auto" },
        small: { maxAmount: 1000, approval: "auto-logged" },
        medium: { maxAmount: 10000, approval: "auto-logged" },
        large: { maxAmount: 100000, approval: "notify-delay", delayMinutes: 2 },
        sweep: { maxAmount: null, approval: "owner-required" },
    },
    limits: {
        dailyMax: 1000000, // High limit for testnet
        hourlyMax: 100000,
        txCountDailyMax: 500,
        cooldownSeconds: 5,
    },
    allowlist: [],
    denylist: [],
    freeze: false,
};
// ============================================================================
// Mainnet UTXO Defaults
// ============================================================================
export const MAINNET_UTXO_DEFAULTS = {
    refreshIntervalSeconds: 600, // Check UTXOs every 10 minutes (conserve API quota)
    dustThreshold: MAINNET_DUST_THRESHOLD,
    consolidationThreshold: 30, // Recommend consolidation at 30+ UTXOs
    minConfirmations: MAINNET_MIN_CONFIRMATIONS,
};
export const TESTNET_UTXO_DEFAULTS = {
    refreshIntervalSeconds: 30, // Faster refresh for testing
    dustThreshold: TESTNET_DUST_THRESHOLD,
    consolidationThreshold: 100, // Higher threshold for testing
    minConfirmations: TESTNET_MIN_CONFIRMATIONS,
};
// ============================================================================
// Mainnet Fee Defaults
// ============================================================================
export const MAINNET_FEE_DEFAULTS = {
    strategy: "medium",
    maxFeePerKb: 500_000_000, // Max 5 DOGE/KB (safety cap)
    fallbackFeePerKb: 100_000_000, // 1 DOGE/KB fallback
};
export const TESTNET_FEE_DEFAULTS = {
    strategy: "low",
    maxFeePerKb: 1_000_000_000, // Higher cap for testnet
    fallbackFeePerKb: 100_000_000,
};
/**
 * Validate a wallet configuration for mainnet safety.
 * Returns warnings for potentially dangerous settings.
 */
export function validateMainnetConfig(config) {
    const warnings = [];
    const errors = [];
    // Only validate mainnet configs
    if (config.network !== "mainnet") {
        return { valid: true, warnings: [], errors: [] };
    }
    // Check confirmation count
    if (config.utxo.minConfirmations < MAINNET_MIN_CONFIRMATIONS) {
        warnings.push(`Low confirmation requirement (${config.utxo.minConfirmations}). ` +
            `Mainnet recommends at least ${MAINNET_MIN_CONFIRMATIONS} confirmations.`);
    }
    // Check daily limit
    if (config.policy.limits.dailyMax > MAINNET_DAILY_LIMIT_WARNING) {
        warnings.push(`High daily limit (${config.policy.limits.dailyMax} DOGE). ` +
            `Consider setting below ${MAINNET_DAILY_LIMIT_WARNING} DOGE for automated operations.`);
    }
    // Check if policy is disabled
    if (!config.policy.enabled) {
        warnings.push("Spending policy is DISABLED on mainnet. All sends will be auto-approved. " +
            "This is NOT recommended for production use.");
    }
    // Check tier thresholds
    const microMax = config.policy.tiers.micro.maxAmount ?? 0;
    if (microMax > 10) {
        warnings.push(`High micro tier threshold (${microMax} DOGE). ` +
            `Auto-approved amounts should be small on mainnet.`);
    }
    // Check for auto-approval on high amounts
    const mediumApproval = config.policy.tiers.medium.approval;
    if (mediumApproval === "auto" || mediumApproval === "auto-logged") {
        const mediumMax = config.policy.tiers.medium.maxAmount ?? 0;
        if (mediumMax > 100) {
            warnings.push(`Medium tier (up to ${mediumMax} DOGE) uses auto-approval. ` +
                `Consider requiring approval for amounts this large.`);
        }
    }
    // Check cooldown
    if (config.policy.limits.cooldownSeconds < 10) {
        warnings.push(`Low cooldown (${config.policy.limits.cooldownSeconds}s). ` +
            `Mainnet recommends at least 10 seconds between sends.`);
    }
    // Check dust threshold
    if (config.utxo.dustThreshold < MAINNET_DUST_THRESHOLD) {
        warnings.push(`Low dust threshold (${config.utxo.dustThreshold} koinu). ` +
            `Mainnet recommends at least ${MAINNET_DUST_THRESHOLD} koinu.`);
    }
    // Check allowlist is not too permissive
    if (config.policy.allowlist.length > 10) {
        warnings.push(`Large allowlist (${config.policy.allowlist.length} addresses). ` +
            `Allowlisted addresses bypass tier checks. Keep this list minimal.`);
    }
    // Check fee strategy
    if (config.fees.strategy === "low") {
        warnings.push("Using 'low' fee strategy on mainnet. " +
            "Transactions may be slow to confirm during high network activity.");
    }
    return {
        valid: errors.length === 0,
        warnings,
        errors,
    };
}
// ============================================================================
// Configuration Helpers
// ============================================================================
/**
 * Get network-appropriate default policy config.
 */
export function getDefaultPolicy(network) {
    return network === "mainnet" ? { ...MAINNET_POLICY_DEFAULTS } : { ...TESTNET_POLICY_DEFAULTS };
}
/**
 * Get network-appropriate default UTXO config.
 */
export function getDefaultUtxoConfig(network) {
    return network === "mainnet" ? { ...MAINNET_UTXO_DEFAULTS } : { ...TESTNET_UTXO_DEFAULTS };
}
/**
 * Get network-appropriate default fee config.
 */
export function getDefaultFeeConfig(network) {
    return network === "mainnet" ? { ...MAINNET_FEE_DEFAULTS } : { ...TESTNET_FEE_DEFAULTS };
}
/**
 * Get the minimum confirmations for a network.
 */
export function getMinConfirmations(network) {
    return network === "mainnet" ? MAINNET_MIN_CONFIRMATIONS : TESTNET_MIN_CONFIRMATIONS;
}
/**
 * Get the dust threshold for a network.
 */
export function getDustThreshold(network) {
    return network === "mainnet" ? MAINNET_DUST_THRESHOLD : TESTNET_DUST_THRESHOLD;
}
/**
 * Apply mainnet safety defaults to a configuration.
 * This upgrades config values to mainnet-safe minimums without overriding
 * explicitly stricter settings.
 */
export function applyMainnetSafetyDefaults(config) {
    if (config.network !== "mainnet") {
        return config;
    }
    return {
        ...config,
        utxo: {
            ...config.utxo,
            minConfirmations: Math.max(config.utxo.minConfirmations, MAINNET_MIN_CONFIRMATIONS),
            dustThreshold: Math.max(config.utxo.dustThreshold, MAINNET_DUST_THRESHOLD),
        },
        policy: {
            ...config.policy,
            enabled: true, // Force policy enabled on mainnet
            limits: {
                ...config.policy.limits,
                cooldownSeconds: Math.max(config.policy.limits.cooldownSeconds, 10),
            },
        },
    };
}
/**
 * Run pre-flight checks before enabling mainnet.
 */
export function runMainnetPreflightChecks(config) {
    const checks = [];
    // Check 1: Network is actually mainnet
    checks.push({
        name: "Network Configuration",
        passed: config.network === "mainnet",
        message: config.network === "mainnet"
            ? "Network is set to mainnet"
            : `Network is set to ${config.network} — change to mainnet for production`,
    });
    // Check 2: Policy is enabled
    checks.push({
        name: "Spending Policy",
        passed: config.policy.enabled,
        message: config.policy.enabled
            ? "Spending policy is enabled"
            : "⚠️ Spending policy is DISABLED — all sends will be auto-approved",
    });
    // Check 3: Reasonable daily limit
    const dailyMax = config.policy.limits.dailyMax;
    const dailyOk = dailyMax <= MAINNET_RECOMMENDED_DAILY_MAX;
    checks.push({
        name: "Daily Limit",
        passed: dailyOk,
        message: dailyOk
            ? `Daily limit: ${dailyMax} DOGE (within recommended ${MAINNET_RECOMMENDED_DAILY_MAX})`
            : `⚠️ Daily limit ${dailyMax} DOGE exceeds recommended ${MAINNET_RECOMMENDED_DAILY_MAX}`,
    });
    // Check 4: Confirmation count
    const confOk = config.utxo.minConfirmations >= MAINNET_MIN_CONFIRMATIONS;
    checks.push({
        name: "Confirmation Count",
        passed: confOk,
        message: confOk
            ? `Minimum confirmations: ${config.utxo.minConfirmations}`
            : `⚠️ Low confirmations (${config.utxo.minConfirmations}), recommend ${MAINNET_MIN_CONFIRMATIONS}+`,
    });
    // Check 5: Notifications enabled
    const notifyOk = config.notifications.enabled;
    checks.push({
        name: "Notifications",
        passed: notifyOk,
        message: notifyOk
            ? "Notifications are enabled"
            : "⚠️ Notifications are disabled — you won't be alerted to transactions",
    });
    // Check 6: Fee strategy is not too low
    const feeOk = config.fees.strategy !== "low";
    checks.push({
        name: "Fee Strategy",
        passed: feeOk,
        message: feeOk
            ? `Fee strategy: ${config.fees.strategy}`
            : "⚠️ Using 'low' fee strategy — transactions may be slow",
    });
    // Check 7: Cooldown is reasonable
    const cooldownOk = config.policy.limits.cooldownSeconds >= 10;
    checks.push({
        name: "Transaction Cooldown",
        passed: cooldownOk,
        message: cooldownOk
            ? `Cooldown: ${config.policy.limits.cooldownSeconds}s between sends`
            : `⚠️ Low cooldown (${config.policy.limits.cooldownSeconds}s) — recommend 10s+`,
    });
    return {
        passed: checks.every((c) => c.passed),
        checks,
    };
}
//# sourceMappingURL=mainnet-config.js.map