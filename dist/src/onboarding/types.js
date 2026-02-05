/**
 * DOGE Wallet — Onboarding Types
 *
 * Type definitions for the onboarding flow.
 * Much types. Very guided. Wow. 🐕
 */
// ============================================================================
// Onboarding State Machine
// ============================================================================
export var OnboardingState;
(function (OnboardingState) {
    OnboardingState["NONE"] = "none";
    OnboardingState["WELCOME"] = "welcome";
    OnboardingState["PASSPHRASE_PENDING"] = "passphrase_pending";
    OnboardingState["PASSPHRASE_WEAK_WARNING"] = "passphrase_weak_warning";
    OnboardingState["PHRASE_DISPLAYED"] = "phrase_displayed";
    OnboardingState["VERIFICATION_PENDING"] = "verification_pending";
    OnboardingState["LIMITS_PENDING"] = "limits_pending";
    OnboardingState["COMPLETE"] = "complete";
})(OnboardingState || (OnboardingState = {}));
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
};
export const SPENDING_LIMIT_OPTIONS = [
    { amount: 1, label: '1 DOGE', description: 'Very conservative — most transactions need approval' },
    { amount: 5, label: '5 DOGE', description: 'Low risk — small autonomous transactions' },
    { amount: 10, label: '10 DOGE', description: 'Recommended — balanced autonomy & security' },
    { amount: 25, label: '25 DOGE', description: 'Higher autonomy — fewer interruptions' },
    { amount: null, label: 'None', description: 'Always ask — maximum control' },
];
//# sourceMappingURL=types.js.map