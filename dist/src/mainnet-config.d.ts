/**
 * DOGE Wallet — Mainnet Configuration
 *
 * Production-ready defaults and safety checks for mainnet deployment.
 * These are conservative settings that prioritize security over convenience.
 *
 * Much mainnet. Very production. Wow. 🐕
 */
import type { DogeWalletConfig, PolicyConfig, UtxoConfig, FeesConfig } from "./types.js";
/** Mainnet minimum confirmations (6 blocks ≈ 6 minutes) */
export declare const MAINNET_MIN_CONFIRMATIONS = 6;
/** Testnet minimum confirmations (1 block for faster testing) */
export declare const TESTNET_MIN_CONFIRMATIONS = 1;
/** Mainnet dust threshold in koinu (0.01 DOGE - more conservative than protocol minimum) */
export declare const MAINNET_DUST_THRESHOLD = 1000000;
/** Testnet dust threshold in koinu (0.001 DOGE - lower for testing) */
export declare const TESTNET_DUST_THRESHOLD = 100000;
/** Mainnet daily limit warning threshold (DOGE) */
export declare const MAINNET_DAILY_LIMIT_WARNING = 1000;
/** Maximum recommended daily limit for automated operations (DOGE) */
export declare const MAINNET_RECOMMENDED_DAILY_MAX = 5000;
/** Minimum fee rate for mainnet (koinu/byte) - ensures timely confirmation */
export declare const MAINNET_MIN_FEE_RATE = 1000;
/** Default fee strategy for mainnet */
export declare const MAINNET_DEFAULT_FEE_STRATEGY: "low" | "medium" | "high";
/** Mainnet recommended cooldown between sends (seconds) */
export declare const MAINNET_COOLDOWN_SECONDS = 30;
/** Testnet cooldown (faster for testing) */
export declare const TESTNET_COOLDOWN_SECONDS = 5;
/**
 * Conservative policy defaults for mainnet.
 * These settings require more approval and have stricter limits.
 */
export declare const MAINNET_POLICY_DEFAULTS: PolicyConfig;
/**
 * More permissive policy for testnet (faster iteration).
 */
export declare const TESTNET_POLICY_DEFAULTS: PolicyConfig;
export declare const MAINNET_UTXO_DEFAULTS: UtxoConfig;
export declare const TESTNET_UTXO_DEFAULTS: UtxoConfig;
export declare const MAINNET_FEE_DEFAULTS: FeesConfig;
export declare const TESTNET_FEE_DEFAULTS: FeesConfig;
export interface ConfigValidationResult {
    valid: boolean;
    warnings: string[];
    errors: string[];
}
/**
 * Validate a wallet configuration for mainnet safety.
 * Returns warnings for potentially dangerous settings.
 */
export declare function validateMainnetConfig(config: DogeWalletConfig): ConfigValidationResult;
/**
 * Get network-appropriate default policy config.
 */
export declare function getDefaultPolicy(network: "mainnet" | "testnet"): PolicyConfig;
/**
 * Get network-appropriate default UTXO config.
 */
export declare function getDefaultUtxoConfig(network: "mainnet" | "testnet"): UtxoConfig;
/**
 * Get network-appropriate default fee config.
 */
export declare function getDefaultFeeConfig(network: "mainnet" | "testnet"): FeesConfig;
/**
 * Get the minimum confirmations for a network.
 */
export declare function getMinConfirmations(network: "mainnet" | "testnet"): number;
/**
 * Get the dust threshold for a network.
 */
export declare function getDustThreshold(network: "mainnet" | "testnet"): number;
/**
 * Apply mainnet safety defaults to a configuration.
 * This upgrades config values to mainnet-safe minimums without overriding
 * explicitly stricter settings.
 */
export declare function applyMainnetSafetyDefaults(config: DogeWalletConfig): DogeWalletConfig;
export interface PreflightCheckResult {
    passed: boolean;
    checks: Array<{
        name: string;
        passed: boolean;
        message: string;
    }>;
}
/**
 * Run pre-flight checks before enabling mainnet.
 */
export declare function runMainnetPreflightChecks(config: DogeWalletConfig): PreflightCheckResult;
//# sourceMappingURL=mainnet-config.d.ts.map