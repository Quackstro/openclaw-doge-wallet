/**
 * DOGE Wallet — Onboarding Flow Handler
 *
 * Orchestrates the step-by-step wallet setup flow.
 * Handles state transitions, user input, and button callbacks.
 *
 * Much guide. Very onboard. Wow. 🐕
 */
import { OnboardingState, type OnboardingContext } from './types.js';
import { type InlineKeyboard } from './message-utils.js';
import type { WalletManager } from '../keys/manager.js';
export interface OnboardingFlowConfig {
    dataDir: string;
    walletManager: WalletManager;
    log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
}
export interface FlowResult {
    text: string;
    keyboard?: InlineKeyboard;
    parseMode?: 'Markdown' | 'HTML';
    deleteMessageId?: string;
}
export declare class OnboardingFlow {
    private readonly stateManager;
    private readonly walletManager;
    private readonly dataDir;
    private readonly log;
    private tempPassphrases;
    private cleanupInterval;
    constructor(config: OnboardingFlowConfig);
    /**
     * Set a temporary passphrase with expiration.
     */
    private setTempPassphrase;
    /**
     * Get a temporary passphrase if not expired.
     */
    private getTempPassphrase;
    /**
     * Delete a temporary passphrase.
     */
    private deleteTempPassphrase;
    /**
     * Clean up expired passphrases from the in-memory map.
     */
    private cleanupExpiredPassphrases;
    /**
     * Stop the cleanup interval (call on shutdown).
     */
    destroy(): void;
    /**
     * Handle a text message during onboarding.
     * Returns null if no active onboarding session or not expecting text input.
     */
    handleMessage(ctx: OnboardingContext): Promise<FlowResult | null>;
    /**
     * Handle a callback button press during onboarding.
     */
    handleCallback(ctx: OnboardingContext): Promise<FlowResult | null>;
    /**
     * Check if onboarding should be started (wallet not initialized).
     * Called when /wallet command is invoked.
     */
    shouldStartOnboarding(chatId: string): Promise<boolean>;
    /**
     * Start or resume onboarding.
     * Returns the welcome message or resume prompt.
     */
    startOrResume(chatId: string): Promise<FlowResult>;
    /**
     * Get the current onboarding state for a chat.
     */
    getState(chatId: string): Promise<OnboardingState>;
    /**
     * Check if a chat is currently in onboarding.
     */
    isOnboarding(chatId: string): Promise<boolean>;
    /**
     * Show the welcome message.
     */
    handleWelcome(chatId: string): Promise<FlowResult>;
    /**
     * Handle the "Let's Go" button - transition to passphrase prompt.
     */
    private handleStart;
    /**
     * Handle the "Learn More" button.
     *
     * NOTE: This intentionally stays in WELCOME state - if app restarts,
     * user sees the welcome message again rather than expanded info.
     * This is a deliberate design choice for a smoother user experience.
     */
    private handleLearnMore;
    /**
     * Handle passphrase text input from user.
     */
    private handlePassphraseInput;
    /**
     * Handle "Try Again" button for weak passphrase.
     */
    private handlePassphraseRetry;
    /**
     * Handle "Use Anyway" button for weak passphrase.
     *
     * SECURITY FIX: Don't delete passphrase until wallet init succeeds.
     * This fixes a race condition where passphrase would be deleted before
     * the wallet was successfully initialized.
     */
    private handlePassphraseWeakOk;
    /**
     * Common logic to proceed after passphrase is accepted.
     */
    private proceedWithPassphrase;
    /**
     * Handle "I've Written It Down" button.
     */
    private handlePhraseSaved;
    /**
     * Handle "Show Phrase Again" button.
     * Requires passphrase re-verification for security.
     */
    private handlePhraseShowAgain;
    /**
     * Handle verification retry button.
     */
    private handleVerifyRetry;
    /**
     * Handle verification input from user.
     */
    private handleVerificationInput;
    /**
     * Handle spending limits "Customize" button.
     */
    private handleLimitsCustom;
    /**
     * Handle spending limit selection.
     */
    private handleLimitsSelection;
    /**
     * Apply the selected spending limit to the policy engine configuration.
     * Updates the config.json file with the new tier settings.
     */
    private applySpendingLimit;
    /**
     * Complete the onboarding flow.
     */
    private handleComplete;
    /**
     * Handle resume of an interrupted session.
     */
    private handleResume;
    /**
     * Handle restart of onboarding (clear and start fresh).
     */
    private handleRestart;
    /**
     * Clean up expired sessions.
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=flow.d.ts.map