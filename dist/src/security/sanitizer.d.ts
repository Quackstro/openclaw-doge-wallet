/**
 * DOGE Wallet — Input Sanitization
 *
 * Sanitizes and validates all user-provided input to prevent injection attacks,
 * XSS, and other security issues.
 *
 * Much clean. Very safe. Wow. 🐕
 */
export interface SanitizationResult<T> {
    /** Whether the input is valid */
    valid: boolean;
    /** Sanitized value (if valid) */
    value?: T;
    /** Error message (if invalid) */
    error?: string;
}
/** Maximum length for description/reason fields */
export declare const MAX_DESCRIPTION_LENGTH = 500;
/** Maximum length for generic text fields */
export declare const MAX_TEXT_LENGTH = 1000;
/** Maximum length for reference fields */
export declare const MAX_REFERENCE_LENGTH = 100;
/** Minimum DOGE amount (dust threshold in DOGE) */
export declare const MIN_AMOUNT_DOGE = 0.001;
/** Maximum DOGE amount (safety limit — adjustable for mainnet) */
export declare const MAX_AMOUNT_DOGE = 100000000;
/** Mainnet daily limit warning threshold */
export declare const MAINNET_DAILY_LIMIT_WARNING = 1000;
/**
 * Sanitize a description or reason field.
 *
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length (default: MAX_DESCRIPTION_LENGTH)
 */
export declare function sanitizeDescription(input: unknown, maxLength?: number): SanitizationResult<string>;
/**
 * Sanitize a reference/ID field (stricter than description).
 */
export declare function sanitizeReference(input: unknown, maxLength?: number): SanitizationResult<string>;
export interface AmountValidationOptions {
    /** Minimum allowed amount in DOGE (default: MIN_AMOUNT_DOGE) */
    minAmount?: number;
    /** Maximum allowed amount in DOGE (default: MAX_AMOUNT_DOGE) */
    maxAmount?: number;
    /** Network for context-aware validation */
    network?: "mainnet" | "testnet";
    /** Warn if amount exceeds this threshold (mainnet safety) */
    warnThreshold?: number;
}
export interface AmountValidationResult extends SanitizationResult<number> {
    /** Warning message (amount is valid but large) */
    warning?: string;
}
/**
 * Validate a DOGE amount.
 */
export declare function validateAmount(input: unknown, options?: AmountValidationOptions): AmountValidationResult;
/**
 * Validate a DOGE address.
 */
export declare function validateAddress(input: unknown, network?: "mainnet" | "testnet"): SanitizationResult<string>;
/**
 * Validate a callback URL (with SSRF protection).
 */
export declare function validateCallbackUrl(input: unknown): SanitizationResult<string>;
export interface ConfirmationValidationOptions {
    /** Minimum confirmations (default: 1 for testnet, 6 for mainnet) */
    minConfirmations?: number;
    /** Maximum reasonable confirmations (default: 100) */
    maxConfirmations?: number;
    /** Network for default selection */
    network?: "mainnet" | "testnet";
}
/**
 * Validate confirmation count.
 */
export declare function validateConfirmations(input: unknown, options?: ConfirmationValidationOptions): SanitizationResult<number>;
/**
 * Sanitize error messages to prevent information leakage.
 * Removes sensitive details like file paths, internal errors, etc.
 */
export declare function sanitizeErrorMessage(error: unknown): string;
/**
 * Sanitize metadata object (removes functions, limits depth).
 */
export declare function sanitizeMetadata(input: unknown, maxDepth?: number): SanitizationResult<Record<string, unknown>>;
//# sourceMappingURL=sanitizer.d.ts.map