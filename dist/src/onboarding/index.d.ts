/**
 * DOGE Wallet — Onboarding Module
 *
 * Guided wallet setup flow for new users.
 * Barrel export for all onboarding components.
 *
 * Much onboard. Very guide. Wow. 🐕
 */
export { OnboardingState, CALLBACKS, CALLBACK_PREFIX, type OnboardingSession, type OnboardingContext, type OnboardingMessage, type PassphraseStrength, type PassphraseScore, type SpendingLimitOption, SPENDING_LIMIT_OPTIONS, } from './types.js';
export { OnboardingStateManager } from './state.js';
export { OnboardingFlow, type OnboardingFlowConfig, type FlowResult } from './flow.js';
export { validatePassphrase, getStrengthDescription, getSuggestionTip, } from './passphrase-validator.js';
export { setBotToken, deleteUserMessage, formatRecoveryPhrase, pickVerificationIndices, verifyRecoveryWords, welcomeMessage, learnMoreMessage, passphrasePromptMessage, weakPassphraseMessage, recoveryPhraseMessage, verificationPromptMessage, verificationFailedMessage, limitsPromptMessage, customLimitsMessage, completionMessage, resumePromptMessage, inlineRow, inlineGrid, type InlineKeyboard, type InlineKeyboardButton, } from './message-utils.js';
//# sourceMappingURL=index.d.ts.map