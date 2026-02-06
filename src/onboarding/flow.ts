/**
 * DOGE Wallet — Onboarding Flow Handler
 *
 * Orchestrates the step-by-step wallet setup flow.
 * Handles state transitions, user input, and button callbacks.
 *
 * Much guide. Very onboard. Wow. 🐕
 */

import { readFile } from 'node:fs/promises';
import { secureWriteFile } from '../secure-fs.js';
import { join } from 'node:path';
import {
  OnboardingState,
  CALLBACKS,
  CALLBACK_PREFIX,
  type OnboardingContext,
  type OnboardingMessage,
} from './types.js';
import { OnboardingStateManager } from './state.js';
import { validatePassphrase, getStrengthDescription } from './passphrase-validator.js';
import {
  deleteUserMessage,
  formatRecoveryPhrase,
  pickVerificationIndices,
  verifyRecoveryWords,
  welcomeMessage,
  learnMoreMessage,
  passphrasePromptMessage,
  weakPassphraseMessage,
  recoveryPhraseMessage,
  verificationPromptMessage,
  verificationFailedMessage,
  limitsPromptMessage,
  customLimitsMessage,
  completionMessage,
  resumePromptMessage,
  type InlineKeyboard,
} from './message-utils.js';
import type { WalletManager } from '../keys/manager.js';

// ============================================================================
// Types
// ============================================================================

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
  /** SECURITY: Track this bot response message ID for later deletion (e.g., mnemonic display) */
  trackBotMessageForDeletion?: boolean;
  /** SECURITY: Delete a previously tracked bot message by chat ID */
  deleteBotMessageId?: string;
}

/** Temporary passphrase entry with expiration */
interface TempPassphraseEntry {
  value: string;
  expiresAt: number;
}

// Passphrase expiry time (5 minutes)
const PASSPHRASE_EXPIRY_MS = 5 * 60 * 1000;

// Maximum total verification attempts before forcing restart
const MAX_TOTAL_VERIFICATION_ATTEMPTS = 9;

// ============================================================================
// OnboardingFlow Class
// ============================================================================

export class OnboardingFlow {
  private readonly stateManager: OnboardingStateManager;
  private readonly walletManager: WalletManager;
  private readonly dataDir: string;
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;

  // Temporary passphrase storage (in-memory only, with expiration)
  private tempPassphrases: Map<string, TempPassphraseEntry> = new Map();
  // SECURITY: Track bot message IDs containing mnemonic for auto-deletion
  private mnemonicMessageIds: Map<string, string> = new Map();

  // Cleanup interval handle
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: OnboardingFlowConfig) {
    this.stateManager = new OnboardingStateManager(config.dataDir, config.log);
    this.walletManager = config.walletManager;
    this.dataDir = config.dataDir;
    this.log = config.log ?? (() => {});

    // Start periodic cleanup of expired passphrases
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredPassphrases();
    }, 60_000); // Every minute
  }

  /**
   * SECURITY: Track a bot message containing the mnemonic for later auto-deletion.
   */
  trackMnemonicMessage(chatId: string, messageId: string): void {
    this.mnemonicMessageIds.set(chatId, messageId);
  }

  /**
   * SECURITY: Retrieve and clear the tracked mnemonic message ID.
   */
  private popMnemonicMessageId(chatId: string): string | undefined {
    const id = this.mnemonicMessageIds.get(chatId);
    if (id) this.mnemonicMessageIds.delete(chatId);
    return id;
  }

  /**
   * Set a temporary passphrase with expiration.
   */
  private setTempPassphrase(chatId: string, passphrase: string): void {
    this.tempPassphrases.set(chatId, {
      value: passphrase,
      expiresAt: Date.now() + PASSPHRASE_EXPIRY_MS,
    });
  }

  /**
   * Get a temporary passphrase if not expired.
   */
  private getTempPassphrase(chatId: string): string | undefined {
    const entry = this.tempPassphrases.get(chatId);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiresAt) {
      this.tempPassphrases.delete(chatId);
      return undefined;
    }
    
    return entry.value;
  }

  /**
   * Delete a temporary passphrase.
   */
  private deleteTempPassphrase(chatId: string): void {
    this.tempPassphrases.delete(chatId);
  }

  /**
   * Clean up expired passphrases from the in-memory map.
   */
  private cleanupExpiredPassphrases(): void {
    const now = Date.now();
    for (const [chatId, entry] of this.tempPassphrases) {
      if (now > entry.expiresAt) {
        this.tempPassphrases.delete(chatId);
        // SECURITY: Also clean up tracked mnemonic messages for abandoned flows
        this.mnemonicMessageIds.delete(chatId);
      }
    }
  }

  /**
   * Stop the cleanup interval (call on shutdown).
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // --------------------------------------------------------------------------
  // Main Entry Points
  // --------------------------------------------------------------------------

  /**
   * Handle a text message during onboarding.
   * Returns null if no active onboarding session or not expecting text input.
   */
  async handleMessage(ctx: OnboardingContext): Promise<FlowResult | null> {
    const { chatId, text, messageId } = ctx;
    if (!text) return null;

    const state = await this.stateManager.getState(chatId);

    switch (state) {
      case OnboardingState.PASSPHRASE_PENDING:
        return this.handlePassphraseInput(chatId, text, messageId);

      case OnboardingState.VERIFICATION_PENDING:
        return this.handleVerificationInput(chatId, text);

      default:
        // Not expecting text input in this state
        return null;
    }
  }

  /**
   * Handle a callback button press during onboarding.
   */
  async handleCallback(ctx: OnboardingContext): Promise<FlowResult | null> {
    const { chatId, callbackData } = ctx;
    if (!callbackData || !callbackData.startsWith(CALLBACK_PREFIX)) {
      return null;
    }

    const action = callbackData.slice(CALLBACK_PREFIX.length);

    switch (callbackData) {
      case CALLBACKS.START:
        return this.handleStart(chatId);

      case CALLBACKS.LEARN:
        return this.handleLearnMore(chatId);

      case CALLBACKS.PASSPHRASE_RETRY:
        return this.handlePassphraseRetry(chatId);

      case CALLBACKS.PASSPHRASE_WEAK_OK:
        return this.handlePassphraseWeakOk(chatId);

      case CALLBACKS.PHRASE_SAVED:
        return this.handlePhraseSaved(chatId);

      case CALLBACKS.PHRASE_SHOW_AGAIN:
        return this.handlePhraseShowAgain(chatId);

      case CALLBACKS.VERIFY_RETRY:
        return this.handleVerifyRetry(chatId);

      case CALLBACKS.LIMITS_RECOMMENDED:
        return this.handleLimitsSelection(chatId, 10);

      case CALLBACKS.LIMITS_CUSTOM:
        return this.handleLimitsCustom(chatId);

      case CALLBACKS.LIMITS_1:
        return this.handleLimitsSelection(chatId, 1);

      case CALLBACKS.LIMITS_5:
        return this.handleLimitsSelection(chatId, 5);

      case CALLBACKS.LIMITS_10:
        return this.handleLimitsSelection(chatId, 10);

      case CALLBACKS.LIMITS_25:
        return this.handleLimitsSelection(chatId, 25);

      case CALLBACKS.LIMITS_0:
        return this.handleLimitsSelection(chatId, null);

      default:
        // Handle resume/restart
        if (action === 'resume') {
          return this.handleResume(chatId);
        }
        if (action === 'restart') {
          return this.handleRestart(chatId);
        }

        // Return error for unknown callbacks instead of silently ignoring
        this.log('warn', `doge-wallet: unknown onboarding callback: ${callbackData}`);
        return {
          text: '⚠️ Unknown action. Please try again or use /wallet to restart.',
        };
    }
  }

  /**
   * Check if onboarding should be started (wallet not initialized).
   * Called when /wallet command is invoked.
   */
  async shouldStartOnboarding(chatId: string): Promise<boolean> {
    const initialized = await this.walletManager.isInitialized();
    return !initialized;
  }

  /**
   * Start or resume onboarding.
   * Returns the welcome message or resume prompt.
   */
  async startOrResume(chatId: string): Promise<FlowResult> {
    const session = await this.stateManager.getSession(chatId);

    if (session && session.state !== OnboardingState.NONE && session.state !== OnboardingState.COMPLETE) {
      // There's an existing in-progress session
      const { text, keyboard } = resumePromptMessage();
      return { text, keyboard };
    }

    // Start fresh
    return this.handleWelcome(chatId);
  }

  /**
   * Get the current onboarding state for a chat.
   */
  async getState(chatId: string): Promise<OnboardingState> {
    return this.stateManager.getState(chatId);
  }

  /**
   * Check if a chat is currently in onboarding.
   */
  async isOnboarding(chatId: string): Promise<boolean> {
    const state = await this.stateManager.getState(chatId);
    return state !== OnboardingState.NONE && state !== OnboardingState.COMPLETE;
  }

  // --------------------------------------------------------------------------
  // Flow Step Handlers
  // --------------------------------------------------------------------------

  /**
   * Show the welcome message.
   */
  async handleWelcome(chatId: string): Promise<FlowResult> {
    await this.stateManager.startSession(chatId);
    const { text, keyboard } = welcomeMessage();
    return { text, keyboard };
  }

  /**
   * Handle the "Let's Go" button - transition to passphrase prompt.
   */
  private async handleStart(chatId: string): Promise<FlowResult> {
    await this.stateManager.transitionTo(chatId, OnboardingState.PASSPHRASE_PENDING);
    const text = passphrasePromptMessage();
    return { text };
  }

  /**
   * Handle the "Learn More" button.
   * 
   * NOTE: This intentionally stays in WELCOME state - if app restarts,
   * user sees the welcome message again rather than expanded info.
   * This is a deliberate design choice for a smoother user experience.
   */
  private async handleLearnMore(chatId: string): Promise<FlowResult> {
    // Stay in WELCOME state, just show more info
    const { text, keyboard } = learnMoreMessage();
    return { text, keyboard };
  }

  /**
   * Handle passphrase text input from user.
   */
  private async handlePassphraseInput(
    chatId: string,
    passphrase: string,
    messageId?: string
  ): Promise<FlowResult> {
    // Delete the message containing the passphrase immediately
    const result: FlowResult = { text: '' };
    let deletionFailed = false;

    if (messageId) {
      result.deleteMessageId = messageId;
      // Try to delete via utility and track if it fails
      const deleted = await deleteUserMessage(chatId, messageId, this.log);
      if (!deleted) {
        deletionFailed = true;
      }
    }

    // Validate passphrase strength
    const strength = validatePassphrase(passphrase);

    // Security warning prefix if deletion failed
    const securityWarning = deletionFailed
      ? '⚠️ **Could not delete your message** — please delete it manually for security.\n\n'
      : '';

    if (!strength.valid) {
      // Store passphrase temporarily for weak acceptance flow (with expiration)
      this.setTempPassphrase(chatId, passphrase);

      await this.stateManager.transitionTo(chatId, OnboardingState.PASSPHRASE_WEAK_WARNING);
      const { text, keyboard } = weakPassphraseMessage(strength.issues);
      result.text = securityWarning + '✅ Passphrase received (your message was deleted).\n\n' + text;
      result.keyboard = keyboard;
      return result;
    }

    // Passphrase is strong enough - proceed
    result.text = securityWarning;
    return this.proceedWithPassphrase(chatId, passphrase, result);
  }

  /**
   * Handle "Try Again" button for weak passphrase.
   */
  private async handlePassphraseRetry(chatId: string): Promise<FlowResult> {
    // Clear temporary passphrase
    this.deleteTempPassphrase(chatId);

    await this.stateManager.transitionTo(chatId, OnboardingState.PASSPHRASE_PENDING);
    const text = passphrasePromptMessage();
    return { text };
  }

  /**
   * Handle "Use Anyway" button for weak passphrase.
   * 
   * SECURITY FIX: Don't delete passphrase until wallet init succeeds.
   * This fixes a race condition where passphrase would be deleted before
   * the wallet was successfully initialized.
   */
  private async handlePassphraseWeakOk(chatId: string): Promise<FlowResult> {
    const passphrase = this.getTempPassphrase(chatId);
    if (!passphrase) {
      // Session expired or error - restart passphrase step
      await this.stateManager.transitionTo(chatId, OnboardingState.PASSPHRASE_PENDING);
      return {
        text: '⚠️ Session expired. Please enter your passphrase again.\n\n' + passphrasePromptMessage(),
      };
    }

    // Proceed but DON'T delete passphrase yet
    const result = await this.proceedWithPassphrase(chatId, passphrase, { text: '' });

    // Only delete on success (check if we moved to phrase display state)
    const session = await this.stateManager.getSession(chatId);
    if (session?.state === OnboardingState.PHRASE_DISPLAYED) {
      this.deleteTempPassphrase(chatId);
    }

    return result;
  }

  /**
   * Common logic to proceed after passphrase is accepted.
   */
  private async proceedWithPassphrase(
    chatId: string,
    passphrase: string,
    result: FlowResult
  ): Promise<FlowResult> {
    // Store passphrase hash for later re-verification (show phrase again)
    await this.stateManager.setPassphraseHash(chatId, passphrase);

    // Get the passphrase hash for mnemonic encryption
    const passphraseHash = await this.stateManager.getPassphraseHash(chatId);

    // Initialize wallet and get mnemonic
    try {
      const initResult = await this.walletManager.init(passphrase);

      // SECURITY [H-2]: Clear passphrase from memory after use
      // Note: JS strings are immutable and cannot be truly zeroed from V8 heap,
      // but we delete all references ASAP to minimize exposure window.
      this.deleteTempPassphrase(chatId);

      // Store mnemonic temporarily for verification (encrypted at rest)
      if (passphraseHash) {
        await this.stateManager.setTempMnemonic(chatId, initResult.mnemonic, passphraseHash);
      }

      // Transition to phrase display
      await this.stateManager.transitionTo(chatId, OnboardingState.PHRASE_DISPLAYED);

      // Format and show the recovery phrase
      const formattedPhrase = formatRecoveryPhrase(initResult.mnemonic);
      const { text, keyboard } = recoveryPhraseMessage(formattedPhrase);

      result.text = (result.text || '') + '✅ Passphrase secured!\n\n' + text;
      result.keyboard = keyboard;
      result.parseMode = 'Markdown';
      // SECURITY: Track this message so we can auto-delete it after user confirms backup
      result.trackBotMessageForDeletion = true;
      return result;
    } catch (err: unknown) {
      const e = err as Error;
      this.log('error', `doge-wallet: wallet init failed during onboarding: ${e.message}`);
      
      // Clear session on error
      await this.stateManager.clearSession(chatId);

      result.text =
        '❌ Wallet Creation Failed\n\n' +
        'Something went wrong while creating your wallet.\n' +
        'Please try again with /wallet.\n\n' +
        `Error: ${e.message}`;
      return result;
    }
  }

  /**
   * Handle "I've Written It Down" button.
   */
  private async handlePhraseSaved(chatId: string): Promise<FlowResult> {
    // SECURITY: Auto-delete the bot message containing the mnemonic
    const mnemonicMsgId = this.popMnemonicMessageId(chatId);

    // Pick verification words
    const indices = pickVerificationIndices();
    await this.stateManager.setVerificationWords(chatId, indices);

    await this.stateManager.transitionTo(chatId, OnboardingState.VERIFICATION_PENDING);

    const text = verificationPromptMessage(indices);
    return { text, deleteBotMessageId: mnemonicMsgId };
  }

  /**
   * Handle "Show Phrase Again" button.
   * Requires passphrase re-verification for security.
   */
  private async handlePhraseShowAgain(chatId: string): Promise<FlowResult> {
    const passphraseHash = await this.stateManager.getPassphraseHash(chatId);
    const mnemonic = await this.stateManager.getTempMnemonic(chatId, passphraseHash ?? undefined);
    
    if (!mnemonic) {
      // Mnemonic was already consumed/cleared - can't show again
      return {
        text:
          '⚠️ Recovery Phrase Unavailable\n\n' +
          'For security, the recovery phrase can only be shown during initial setup.\n\n' +
          'If you\'ve lost your backup, you\'ll need to start over with /wallet.',
      };
    }

    // Show the phrase again
    const formattedPhrase = formatRecoveryPhrase(mnemonic);
    const { text, keyboard } = recoveryPhraseMessage(formattedPhrase);

    // Stay in the same state
    return { text, keyboard, parseMode: 'Markdown' };
  }

  /**
   * Handle verification retry button.
   */
  private async handleVerifyRetry(chatId: string): Promise<FlowResult> {
    const session = await this.stateManager.getSession(chatId);
    const indices = session?.verificationWords;

    if (!indices || indices.length === 0) {
      // Pick new words
      const newIndices = pickVerificationIndices();
      await this.stateManager.setVerificationWords(chatId, newIndices);
      return { text: verificationPromptMessage(newIndices) };
    }

    return { text: verificationPromptMessage(indices) };
  }

  /**
   * Handle verification input from user.
   */
  private async handleVerificationInput(chatId: string, answers: string): Promise<FlowResult> {
    const session = await this.stateManager.getSession(chatId);
    const passphraseHash = await this.stateManager.getPassphraseHash(chatId);
    const mnemonic = await this.stateManager.getTempMnemonic(chatId, passphraseHash ?? undefined);
    const indices = session?.verificationWords;

    if (!mnemonic || !indices) {
      return {
        text:
          '⚠️ Session Error\n\n' +
          'Your onboarding session has expired. Please start again with /wallet.',
      };
    }

    // Increment total verification attempts (security limit)
    const totalAttempts = await this.stateManager.incrementTotalVerificationAttempts(chatId);

    // Check if too many total attempts across all rounds
    if (totalAttempts >= MAX_TOTAL_VERIFICATION_ATTEMPTS) {
      // Force restart - too many attempts
      await this.stateManager.clearSession(chatId);
      this.deleteTempPassphrase(chatId);
      return {
        text: '❌ Too many failed attempts. For security, please start over with /wallet.',
      };
    }

    const verification = verifyRecoveryWords(mnemonic, indices, answers);

    if (verification.correct) {
      // Clear the mnemonic - no longer needed
      await this.stateManager.clearTempMnemonic(chatId);

      // Proceed to spending limits
      await this.stateManager.transitionTo(chatId, OnboardingState.LIMITS_PENDING);

      const { text, keyboard } = limitsPromptMessage();
      return {
        text: '✅ Perfect! Your recovery phrase is verified.\n\n' + text,
        keyboard,
      };
    }

    // Verification failed
    const attempts = await this.stateManager.incrementVerificationAttempts(chatId);

    if (attempts >= 3) {
      // After 3 failures in this round, force showing the phrase again
      const formattedPhrase = formatRecoveryPhrase(mnemonic);
      const { text, keyboard } = recoveryPhraseMessage(formattedPhrase);

      await this.stateManager.transitionTo(chatId, OnboardingState.PHRASE_DISPLAYED, {
        verificationAttempts: 0,
      });

      return {
        text:
          '❌ Too many incorrect attempts.\n\n' +
          'Here\'s your recovery phrase again. Please write it down carefully:\n\n' +
          text,
        keyboard,
        parseMode: 'Markdown',
      };
    }

    const { text, keyboard } = verificationFailedMessage(verification.mismatches);
    return { text, keyboard };
  }

  /**
   * Handle spending limits "Customize" button.
   */
  private async handleLimitsCustom(chatId: string): Promise<FlowResult> {
    const { text, keyboard } = customLimitsMessage();
    return { text, keyboard };
  }

  /**
   * Handle spending limit selection.
   */
  private async handleLimitsSelection(
    chatId: string,
    limitDoge: number | null
  ): Promise<FlowResult> {
    await this.stateManager.updateSession(chatId, { selectedLimit: limitDoge });

    // Apply the spending limit to the policy config
    await this.applySpendingLimit(limitDoge);

    // Complete onboarding
    return this.handleComplete(chatId, limitDoge);
  }

  /**
   * Apply the selected spending limit to the policy engine configuration.
   * Updates the config.json file with the new tier settings.
   */
  private async applySpendingLimit(limitDoge: number | null): Promise<void> {
    try {
      // Find the config file path
      const configPath = join(this.dataDir, '..', 'config.json');

      let config: Record<string, unknown> = {};
      try {
        const raw = await readFile(configPath, 'utf-8');
        config = JSON.parse(raw);
      } catch (err) {
        // Config file doesn't exist yet, create default structure
        config = { policy: {} };
      }

      // Ensure policy structure exists
      if (!config.policy || typeof config.policy !== 'object') {
        config.policy = {};
      }
      const policy = config.policy as Record<string, unknown>;

      // Ensure tiers structure exists
      if (!policy.tiers || typeof policy.tiers !== 'object') {
        policy.tiers = {};
      }
      const tiers = policy.tiers as Record<string, unknown>;

      if (limitDoge === null) {
        // "Always ask" mode - set all tiers to require approval
        tiers.micro = { maxAmount: 10, approval: 'owner-required' };
        tiers.small = { maxAmount: 100, approval: 'owner-required' };
        tiers.medium = { maxAmount: 1000, approval: 'owner-required' };
        tiers.large = { maxAmount: 10000, approval: 'owner-required' };
        tiers.sweep = { maxAmount: null, approval: 'owner-confirm-code' };
        
        this.log('info', 'doge-wallet: spending policy set to "always ask"');
      } else {
        // Set auto-approve threshold
        // Amounts <= limitDoge are auto-approved (logged)
        // Amounts > limitDoge require notification/approval based on size
        tiers.micro = { 
          maxAmount: limitDoge, 
          approval: 'auto-logged' // Auto but logged
        };
        tiers.small = { 
          maxAmount: Math.max(limitDoge * 10, 100), 
          approval: 'auto-logged' // Notification but auto-approved
        };
        tiers.medium = { 
          maxAmount: Math.max(limitDoge * 100, 1000), 
          approval: 'notify-delay', 
          delayMinutes: 5 
        };
        tiers.large = { 
          maxAmount: Math.max(limitDoge * 1000, 10000), 
          approval: 'owner-required' 
        };
        tiers.sweep = { 
          maxAmount: null, 
          approval: 'owner-confirm-code' 
        };
        
        this.log('info', `doge-wallet: spending policy set to auto-approve up to ${limitDoge} DOGE`);
      }

      // Save updated config
      await secureWriteFile(configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      const e = err as Error;
      this.log('warn', `doge-wallet: failed to save spending policy: ${e.message}`);
      // Non-fatal - continue with onboarding completion
    }
  }

  /**
   * Complete the onboarding flow.
   */
  private async handleComplete(chatId: string, limitDoge: number | null): Promise<FlowResult> {
    // Get the wallet address
    const address = await this.walletManager.getAddress();

    if (!address) {
      return {
        text:
          '❌ Error: Could not retrieve wallet address.\n' +
          'The wallet may not have been initialized correctly.\n' +
          'Please try again with /wallet.',
      };
    }

    // Mark onboarding as complete
    await this.stateManager.transitionTo(chatId, OnboardingState.COMPLETE);

    // Clear the session (keep minimal record if needed)
    await this.stateManager.clearSession(chatId);

    // Clean up temp passphrase if any
    this.deleteTempPassphrase(chatId);

    // Build completion message
    const { text, keyboard } = completionMessage(address);

    const limitText = limitDoge === null
      ? 'Always ask for approval'
      : `Auto-approve up to ${limitDoge} DOGE`;

    return {
      text: `⚙️ Spending limit set: ${limitText}\n\n` + text,
      keyboard,
      parseMode: 'Markdown',
    };
  }

  /**
   * Handle resume of an interrupted session.
   */
  private async handleResume(chatId: string): Promise<FlowResult> {
    const session = await this.stateManager.getSession(chatId);
    if (!session) {
      return this.handleWelcome(chatId);
    }

    const passphraseHash = await this.stateManager.getPassphraseHash(chatId);

    // Resume from current state
    switch (session.state) {
      case OnboardingState.WELCOME:
        const { text, keyboard } = welcomeMessage();
        return { text, keyboard };

      case OnboardingState.PASSPHRASE_PENDING:
        return { text: passphrasePromptMessage() };

      case OnboardingState.PASSPHRASE_WEAK_WARNING:
        // Lost context (temp passphrase) - restart passphrase with context message
        await this.stateManager.transitionTo(chatId, OnboardingState.PASSPHRASE_PENDING);
        return {
          text: '⚠️ Your session was interrupted. Let\'s set up your passphrase again.\n\n' +
                passphrasePromptMessage(),
        };

      case OnboardingState.PHRASE_DISPLAYED:
        const mnemonic = await this.stateManager.getTempMnemonic(chatId, passphraseHash ?? undefined);
        if (mnemonic) {
          const formattedPhrase = formatRecoveryPhrase(mnemonic);
          const { text, keyboard } = recoveryPhraseMessage(formattedPhrase);
          return { text, keyboard, parseMode: 'Markdown' };
        }
        // Lost mnemonic - can't resume
        return {
          text:
            '⚠️ Session Expired\n\n' +
            'For security, your recovery phrase is no longer available.\n' +
            'Please start setup again.',
          keyboard: [
            [{ text: '🔄 Start Over', callback_data: 'doge:onboard:restart' }],
          ],
        };

      case OnboardingState.VERIFICATION_PENDING:
        const indices = session.verificationWords;
        if (indices) {
          return { text: verificationPromptMessage(indices) };
        }
        // Pick new verification words
        const newIndices = pickVerificationIndices();
        await this.stateManager.setVerificationWords(chatId, newIndices);
        return { text: verificationPromptMessage(newIndices) };

      case OnboardingState.LIMITS_PENDING:
        const { text: limitsText, keyboard: limitsKeyboard } = limitsPromptMessage();
        return { text: limitsText, keyboard: limitsKeyboard };

      default:
        return this.handleWelcome(chatId);
    }
  }

  /**
   * Handle restart of onboarding (clear and start fresh).
   */
  private async handleRestart(chatId: string): Promise<FlowResult> {
    await this.stateManager.clearSession(chatId);
    this.deleteTempPassphrase(chatId);
    return this.handleWelcome(chatId);
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /**
   * Clean up expired sessions.
   */
  async cleanup(): Promise<void> {
    await this.stateManager.cleanupExpiredSessions();
    this.cleanupExpiredPassphrases();
  }
}
