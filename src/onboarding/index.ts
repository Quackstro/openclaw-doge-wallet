/**
 * DOGE Wallet — Onboarding Module
 *
 * Guided wallet setup flow for new users.
 * Barrel export for all onboarding components.
 *
 * Much onboard. Very guide. Wow. 🐕
 */

// Types
export {
  OnboardingState,
  CALLBACKS,
  CALLBACK_PREFIX,
  type OnboardingSession,
  type OnboardingContext,
  type OnboardingMessage,
  type PassphraseStrength,
  type PassphraseScore,
  type SpendingLimitOption,
  SPENDING_LIMIT_OPTIONS,
} from './types.js';

// State Manager
export { OnboardingStateManager } from './state.js';

// Flow Handler
export { OnboardingFlow, type OnboardingFlowConfig, type FlowResult } from './flow.js';

// Passphrase Validation
export {
  validatePassphrase,
  getStrengthDescription,
  getSuggestionTip,
} from './passphrase-validator.js';

// Message Utilities
export {
  setBotToken,
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
  inlineRow,
  inlineGrid,
  type InlineKeyboard,
  type InlineKeyboardButton,
} from './message-utils.js';
