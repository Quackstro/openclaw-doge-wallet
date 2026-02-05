/**
 * DOGE Wallet — Onboarding Types
 *
 * Type definitions for the onboarding flow.
 * Much types. Very guided. Wow. 🐕
 */
export declare enum OnboardingState {
    NONE = "none",
    WELCOME = "welcome",
    PASSPHRASE_PENDING = "passphrase_pending",
    PASSPHRASE_WEAK_WARNING = "passphrase_weak_warning",
    PHRASE_DISPLAYED = "phrase_displayed",
    VERIFICATION_PENDING = "verification_pending",
    LIMITS_PENDING = "limits_pending",
    COMPLETE = "complete"
}
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
export interface OnboardingMessage {
    text: string;
    buttons?: InlineButton[][];
    parseMode?: 'Markdown' | 'HTML';
}
export interface InlineButton {
    text: string;
    callbackData: string;
}
export declare const CALLBACK_PREFIX = "doge:onboard:";
export declare const CALLBACKS: {
    readonly START: "doge:onboard:start";
    readonly LEARN: "doge:onboard:learn";
    readonly PASSPHRASE_RETRY: "doge:onboard:passphrase_retry";
    readonly PASSPHRASE_WEAK_OK: "doge:onboard:passphrase_weak_ok";
    readonly PHRASE_SAVED: "doge:onboard:phrase_saved";
    readonly PHRASE_SHOW_AGAIN: "doge:onboard:phrase_show_again";
    readonly VERIFY_RETRY: "doge:onboard:verify_retry";
    readonly LIMITS_RECOMMENDED: "doge:onboard:limits:recommended";
    readonly LIMITS_CUSTOM: "doge:onboard:limits:custom";
    readonly LIMITS_1: "doge:onboard:limits:1";
    readonly LIMITS_5: "doge:onboard:limits:5";
    readonly LIMITS_10: "doge:onboard:limits:10";
    readonly LIMITS_25: "doge:onboard:limits:25";
    readonly LIMITS_0: "doge:onboard:limits:0";
};
export interface OnboardingContext {
    chatId: string;
    messageId?: string;
    text?: string;
    callbackData?: string;
}
export interface SpendingLimitOption {
    /** Amount in DOGE (null = always ask) */
    amount: number | null;
    /** Display label */
    label: string;
    /** Description */
    description: string;
}
export declare const SPENDING_LIMIT_OPTIONS: SpendingLimitOption[];
//# sourceMappingURL=types.d.ts.map