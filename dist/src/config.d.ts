/**
 * DOGE Wallet — Config Loading + Validation
 *
 * Reads config from the plugin API, applies defaults, validates required fields.
 * Much config. Very validate. Wow. 🐕
 */
import type { DogeWalletConfig } from "./types.js";
/**
 * Parse and validate the plugin config.
 * Returns a fully-populated DogeWalletConfig with defaults applied.
 */
export declare function parseDogeConfig(raw: unknown): DogeWalletConfig;
/**
 * Check if the wallet has been initialized (has a keystore file on disk).
 * Synchronous check — reads file system.
 */
export declare function isWalletInitialized(config: DogeWalletConfig): boolean;
//# sourceMappingURL=config.d.ts.map