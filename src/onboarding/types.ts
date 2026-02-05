/**
 * DOGE Wallet — Onboarding Types
 *
 * Type definitions for the onboarding flow.
 * Much types. Very guided. Wow. 🐕
 */

// ============================================================================
// Onboarding State Machine
// ============================================================================

export enum OnboardingState {
  NONE = 'none',
  WELCOME = 'welcome',
  PASSPHRASE_PENDING = 'passphrase_pending',
  PASSPHRASE_WEAK_WARNING = 'passphrase_weak_warning',
  PHRASE_DISPLAYED = 'phrase_displayed',
  VERIFICATION_PENDING = 'verification_pending',
  LIMITS_PENDING = 'limits_pending',
  COMPLETE = 'complete'
}

// ============================================================================
// Onboarding Session
// ============================================================================

/**
 * Encrypted mnemonic storage structure.
 * Uses AES-256-GCM with a key derived from the passphrase hash.
 */
export interface EncryptedMnemonic {
  /** Salt for scrypt key derivation (hex) */
  salt: string;
  /** AES-GCM initialization vector (hex) */
  iv: string;
  /** AES-GCM authentication tag (hex) */
  tag: string;
  /** Encrypted mnemonic data (hex) */
  data: string;
}

export interface OnboardingSession {
  /** Current state in the onboarding flow */
  state: OnboardingState;
  /** Telegram chat ID */
  chatId: string;
  /** ISO timestamp when onboarding started */
  startedAt: string;
  /** ISO timestamp when state last changed */
  lastUpdated: string;
  /** Word indices to verify (1-based) */
  verificationWords?: number[];
  /** Temporary mnemonic — cleared after verification (DEPRECATED: use encryptedMnemonic) */
  tempMnemonic?: string;
  /** Encrypted mnemonic for secure storage at rest */
  encryptedMnemonic?: EncryptedMnemonic;
  /** Temporary passphrase hash for re-verification (format: salt:hash, scrypt-derived) */
  tempPassphraseHash?: string;
  /** Number of verification attempts for current verification round */
  verificationAttempts?: number;
  /** Total verification attempts across all rounds (security limit) */
  totalVerificationAttempts?: number;
  /** Message ID of the phrase display (for reference) */
  phraseMessageId?: string;
  /** Whether the weak passphrase warning was shown */
  weakWarningShown?: boolean;
  /** Selected spending limit in DOGE (null = always ask) */
  selectedLimit?: number | null;
}

// ============================================================================
// Passphrase Validation
// ============================================================================

export type PassphraseScore = 'weak' | 'medium' | 'strong';

export interface PassphraseStrength {
  /** Whether the passphrase meets minimum requirements */
  valid: boolean;
  /** Overall strength score */
  score: PassphraseScore;
  /** Specific issues found */
  issues: string[];
  /** Entropy estimate (bits) */
  entropy: number;
}

// ============================================================================
// Onboarding Messages
// ============================================================================

export interface OnboardingMessage {
  text: string;
  buttons?: InlineButton[][];
  parseMode?: 'Markdown' | 'HTML';
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

// ============================================================================
// Callback Data Patterns
// ============================================================================

export const CALLBACK_PREFIX = 'doge:onboard:';

export const CALLBACKS = {
  START: `${CALLBACK_PREFIX}start`,
  LEARN: `${CALLBACK_PREFIX}learn`,
  PASSPHRASE_RETRY: `${CALLBACK_PREFIX}passphrase_retry`,
  PASSPHRASE_WEAK_OK: `${CALLBACK_PREFIX}passphrase_weak_ok`,
  PHRASE_SAVED: `${CALLBACK_PREFIX}phrase_saved`,
  PHRASE_SHOW_AGAIN: `${CALLBACK_PREFIX}phrase_show_again`,
  VERIFY_RETRY: `${CALLBACK_PREFIX}verify_retry`,
  LIMITS_RECOMMENDED: `${CALLBACK_PREFIX}limits:recommended`,
  LIMITS_CUSTOM: `${CALLBACK_PREFIX}limits:custom`,
  LIMITS_1: `${CALLBACK_PREFIX}limits:1`,
  LIMITS_5: `${CALLBACK_PREFIX}limits:5`,
  LIMITS_10: `${CALLBACK_PREFIX}limits:10`,
  LIMITS_25: `${CALLBACK_PREFIX}limits:25`,
  LIMITS_0: `${CALLBACK_PREFIX}limits:0`,
} as const;

// ============================================================================
// Flow Handler Context
// ============================================================================

export interface OnboardingContext {
  chatId: string;
  messageId?: string;
  text?: string;
  callbackData?: string;
}

// ============================================================================
// Spending Limit Tiers
// ============================================================================

export interface SpendingLimitOption {
  /** Amount in DOGE (null = always ask) */
  amount: number | null;
  /** Display label */
  label: string;
  /** Description */
  description: string;
}

export const SPENDING_LIMIT_OPTIONS: SpendingLimitOption[] = [
  { amount: 1, label: '1 DOGE', description: 'Very conservative — most transactions need approval' },
  { amount: 5, label: '5 DOGE', description: 'Low risk — small autonomous transactions' },
  { amount: 10, label: '10 DOGE', description: 'Recommended — balanced autonomy & security' },
  { amount: 25, label: '25 DOGE', description: 'Higher autonomy — fewer interruptions' },
  { amount: null, label: 'None', description: 'Always ask — maximum control' },
];
