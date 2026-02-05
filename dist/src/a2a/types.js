/**
 * DOGE Wallet — Agent-to-Agent Protocol Types
 *
 * Type definitions for the A2A micro-transaction protocol.
 * Much invoice. Very protocol. Wow. 🐕
 */
// ============================================================================
// Constants
// ============================================================================
/** OP_RETURN prefix for OpenClaw invoice IDs */
export const OP_RETURN_PREFIX = "OC:";
/** Default invoice expiry duration (1 hour) */
export const DEFAULT_EXPIRY_MS = 60 * 60 * 1000;
/** Maximum invoices to keep in storage */
export const MAX_STORED_INVOICES = 100;
/** Minimum confirmations for testnet */
export const MIN_CONFIRMATIONS_TESTNET = 1;
/** Minimum confirmations for mainnet */
export const MIN_CONFIRMATIONS_MAINNET = 6;
//# sourceMappingURL=types.js.map