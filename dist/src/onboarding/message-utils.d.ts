/**
 * DOGE Wallet — Message Utilities for Onboarding
 *
 * Helpers for Telegram message operations during onboarding.
 * Including secure message deletion.
 *
 * Much delete. Very secure. Wow. 🐕
 */
/**
 * Delete a user's message from Telegram.
 * Used to immediately remove passphrase messages for security.
 *
 * SECURITY: This is critical for passphrase protection. If deletion fails,
 * the caller should warn the user to delete manually.
 *
 * @param chatId - Telegram chat ID
 * @param messageId - Message ID to delete
 * @param log - Optional logging function
 * @returns true if deleted successfully, false otherwise (caller should warn user)
 */
export declare function deleteUserMessage(chatId: string, messageId: string, log?: (level: 'info' | 'warn' | 'error', msg: string) => void): Promise<boolean>;
/**
 * Formats a 24-word BIP39 mnemonic for display in a readable 4-column layout.
 *
 * NOTE: We use 24 words (256 bits of entropy) for maximum security.
 * Some wallets use 12 words (128 bits) but we prioritize security
 * over convenience given this handles real money.
 *
 * Example output:
 * ```
 *  1. witch      7. abandon   13. fossil   19. mixed
 *  2. collapse   8. grocery   14. verify   20. toast
 *  ...
 * ```
 *
 * @param mnemonic - Space-separated 24-word BIP39 mnemonic
 * @returns Formatted string with numbered words in 4 columns
 * @throws Error if mnemonic doesn't have exactly 24 words
 */
export declare function formatRecoveryPhrase(mnemonic: string): string;
/**
 * Pick 3 random word indices for verification (1-based).
 * Avoids adjacent indices and ensures good spread.
 */
export declare function pickVerificationIndices(): number[];
/**
 * Verify that the user's answers match the expected words.
 *
 * @param mnemonic - The full 24-word mnemonic
 * @param indices - The 1-based indices that were asked
 * @param answers - The user's answers (space or comma separated)
 * @returns Object with correct flag and details
 */
export declare function verifyRecoveryWords(mnemonic: string, indices: number[], answers: string): {
    correct: boolean;
    expected: string[];
    provided: string[];
    mismatches: Array<{
        index: number;
        expected: string;
        provided: string;
    }>;
};
export interface InlineKeyboardButton {
    text: string;
    callback_data?: string;
    url?: string;
}
export type InlineKeyboard = InlineKeyboardButton[][];
/**
 * Create a single-row inline keyboard.
 */
export declare function inlineRow(...buttons: Array<{
    text: string;
    callback: string;
}>): InlineKeyboard;
/**
 * Create a multi-row inline keyboard.
 */
export declare function inlineGrid(rows: Array<Array<{
    text: string;
    callback: string;
}>>): InlineKeyboard;
/**
 * Create the welcome message content.
 */
export declare function welcomeMessage(): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the "learn more" expanded message.
 */
export declare function learnMoreMessage(): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the passphrase prompt message.
 */
export declare function passphrasePromptMessage(): string;
/**
 * Create the weak passphrase warning message.
 */
export declare function weakPassphraseMessage(issues: string[]): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the recovery phrase display message.
 */
export declare function recoveryPhraseMessage(formattedPhrase: string): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the verification prompt message.
 */
export declare function verificationPromptMessage(indices: number[]): string;
/**
 * Create the verification failure message.
 */
export declare function verificationFailedMessage(mismatches: Array<{
    index: number;
    expected: string;
    provided: string;
}>): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the spending limits prompt message.
 */
export declare function limitsPromptMessage(): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the custom limits selection message.
 */
export declare function customLimitsMessage(): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the completion message.
 */
export declare function completionMessage(address: string): {
    text: string;
    keyboard: InlineKeyboard;
};
/**
 * Create the resume prompt for abandoned sessions.
 */
export declare function resumePromptMessage(): {
    text: string;
    keyboard: InlineKeyboard;
};
//# sourceMappingURL=message-utils.d.ts.map