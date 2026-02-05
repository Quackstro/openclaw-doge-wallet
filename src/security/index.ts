/**
 * DOGE Wallet — Security Module Index
 *
 * Exports all security-related utilities: rate limiting, sanitization, validation.
 *
 * Much secure. Very export. Wow. 🐕
 */

// Rate Limiter
export {
  RateLimiter,
  RateLimitError,
  withRateLimit,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
  type RateLimitResult,
  type RateLimitEntry,
} from "./rate-limiter.js";

// Input Sanitization
export {
  sanitizeDescription,
  sanitizeReference,
  sanitizeMetadata,
  sanitizeErrorMessage,
  validateAmount,
  validateAddress,
  validateCallbackUrl,
  validateConfirmations,
  MAX_DESCRIPTION_LENGTH,
  MAX_TEXT_LENGTH,
  MAX_REFERENCE_LENGTH,
  MIN_AMOUNT_DOGE,
  MAX_AMOUNT_DOGE,
  MAINNET_DAILY_LIMIT_WARNING,
  type SanitizationResult,
  type AmountValidationOptions,
  type AmountValidationResult,
  type ConfirmationValidationOptions,
} from "./sanitizer.js";
