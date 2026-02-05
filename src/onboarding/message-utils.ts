/**
 * DOGE Wallet — Message Utilities for Onboarding
 *
 * Helpers for Telegram message operations during onboarding.
 * Including secure message deletion.
 *
 * Much delete. Very secure. Wow. 🐕
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// ============================================================================
// Message Deletion
// ============================================================================

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
export async function deleteUserMessage(
  chatId: string,
  messageId: string,
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
): Promise<boolean> {
  try {
    // Use OpenClaw CLI to delete the message
    await execFileP('openclaw', [
      'message',
      'delete',
      '--channel', 'telegram',
      '--target', chatId,
      '--message-id', messageId,
    ], { timeout: 10_000 });

    log?.('info', `doge-wallet: deleted message ${messageId} in chat ${chatId}`);
    return true;
  } catch (err: unknown) {
    const e = err as Error;
    log?.('warn', `doge-wallet: failed to delete message ${messageId}: ${e.message}`);
    return false;
  }
}

// ============================================================================
// Recovery Phrase Formatting
// ============================================================================

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
export function formatRecoveryPhrase(mnemonic: string): string {
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`Expected 24 words, got ${words.length}`);
  }

  // Find max word length for padding
  const maxLen = Math.max(...words.map(w => w.length));

  // Build 6 rows × 4 columns
  const lines: string[] = [];
  for (let row = 0; row < 6; row++) {
    const cols: string[] = [];
    for (let col = 0; col < 4; col++) {
      const idx = row + col * 6; // column-first ordering
      const num = (idx + 1).toString().padStart(2, ' ');
      const word = words[idx].padEnd(maxLen, ' ');
      cols.push(`${num}. ${word}`);
    }
    lines.push(cols.join('  '));
  }

  return lines.join('\n');
}

/**
 * Pick 3 random word indices for verification (1-based).
 * Avoids adjacent indices and ensures good spread.
 */
export function pickVerificationIndices(): number[] {
  // Split into three regions and pick one from each
  // Region 1: 1-8, Region 2: 9-16, Region 3: 17-24
  const regions = [
    [1, 2, 3, 4, 5, 6, 7, 8],
    [9, 10, 11, 12, 13, 14, 15, 16],
    [17, 18, 19, 20, 21, 22, 23, 24],
  ];

  const indices: number[] = [];
  for (const region of regions) {
    const randomIdx = Math.floor(Math.random() * region.length);
    indices.push(region[randomIdx]);
  }

  return indices.sort((a, b) => a - b);
}

/**
 * Verify that the user's answers match the expected words.
 *
 * @param mnemonic - The full 24-word mnemonic
 * @param indices - The 1-based indices that were asked
 * @param answers - The user's answers (space or comma separated)
 * @returns Object with correct flag and details
 */
export function verifyRecoveryWords(
  mnemonic: string,
  indices: number[],
  answers: string
): {
  correct: boolean;
  expected: string[];
  provided: string[];
  mismatches: Array<{ index: number; expected: string; provided: string }>;
} {
  const words = mnemonic.trim().split(/\s+/);
  const expected = indices.map(i => words[i - 1].toLowerCase());
  
  // Parse user answers - split by space, comma, or newline
  const provided = answers
    .toLowerCase()
    .split(/[\s,\n]+/)
    .map(w => w.trim())
    .filter(w => w.length > 0);

  const mismatches: Array<{ index: number; expected: string; provided: string }> = [];

  for (let i = 0; i < indices.length; i++) {
    const exp = expected[i];
    const prov = provided[i] ?? '';
    if (exp !== prov) {
      mismatches.push({ index: indices[i], expected: exp, provided: prov });
    }
  }

  return {
    correct: mismatches.length === 0,
    expected,
    provided,
    mismatches,
  };
}

// ============================================================================
// Inline Button Builders
// ============================================================================

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

/**
 * Create a single-row inline keyboard.
 */
export function inlineRow(
  ...buttons: Array<{ text: string; callback: string }>
): InlineKeyboard {
  return [buttons.map(b => ({ text: b.text, callback_data: b.callback }))];
}

/**
 * Create a multi-row inline keyboard.
 */
export function inlineGrid(
  rows: Array<Array<{ text: string; callback: string }>>
): InlineKeyboard {
  return rows.map(row => 
    row.map(b => ({ text: b.text, callback_data: b.callback }))
  );
}

// ============================================================================
// Message Templates
// ============================================================================

/**
 * Create the welcome message content.
 */
export function welcomeMessage(): { text: string; keyboard: InlineKeyboard } {
  const text = 
    '🐕 Welcome to DOGE Wallet!\n\n' +
    'I can help you send and receive Dogecoin right from this chat.\n' +
    'Before we start, a few things to know:\n\n' +
    '• Your keys are encrypted and stored locally\n' +
    '• I\'ll generate a 24-word recovery phrase — you MUST save it\n' +
    '• You control spending limits for autonomous transactions\n\n' +
    'Ready to set up your wallet?';

  const keyboard = inlineRow(
    { text: '🚀 Let\'s Go', callback: 'doge:onboard:start' },
    { text: '❓ Learn More', callback: 'doge:onboard:learn' }
  );

  return { text, keyboard };
}

/**
 * Create the "learn more" expanded message.
 */
export function learnMoreMessage(): { text: string; keyboard: InlineKeyboard } {
  const text =
    '🐕 Welcome to DOGE Wallet!\n\n' +
    'I can help you send and receive Dogecoin right from this chat.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '📚 How It Works:\n\n' +
    'DOGE Wallet is a self-custodial wallet — you own your keys.\n\n' +
    '• I never see your recovery phrase after setup\n' +
    '• Encrypted with a passphrase only you know\n' +
    '• Works on Dogecoin mainnet (real money!)\n\n' +
    '🔐 Security: Your funds are as safe as your passphrase + recovery phrase.\n\n' +
    '⚠️ Note: Telegram bot messages are NOT end-to-end encrypted. ' +
    'For large amounts, consider a hardware wallet.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    'Ready to set up your wallet?';

  const keyboard = inlineRow(
    { text: '🚀 Let\'s Go', callback: 'doge:onboard:start' }
  );

  return { text, keyboard };
}

/**
 * Create the passphrase prompt message.
 */
export function passphrasePromptMessage(): string {
  return (
    '🔐 Step 1 of 4: Create Your Passphrase\n\n' +
    'Your passphrase encrypts your wallet. Choose something strong:\n' +
    '• At least 12 characters\n' +
    '• Mix of letters, numbers, symbols\n' +
    '• NOT a common phrase\n\n' +
    '⚠️ If you forget this, you\'ll need your recovery phrase to restore.\n\n' +
    '📝 Reply with your passphrase:\n' +
    '(I\'ll delete your message immediately for security)'
  );
}

/**
 * Create the weak passphrase warning message.
 */
export function weakPassphraseMessage(issues: string[]): { text: string; keyboard: InlineKeyboard } {
  const issueList = issues.map(i => `• ${i}`).join('\n');
  
  const text =
    '⚠️ Passphrase Strength Warning\n\n' +
    'Your passphrase has some issues:\n' +
    issueList + '\n\n' +
    '💡 Tip: Use 3-4 random words with numbers, like:\n' +
    '   purple-tiger-42-jumping\n\n' +
    'This wallet holds real money — a strong passphrase is important!';

  const keyboard = inlineRow(
    { text: '🔄 Try Again', callback: 'doge:onboard:passphrase_retry' },
    { text: '⚡ Use Anyway', callback: 'doge:onboard:passphrase_weak_ok' }
  );

  return { text, keyboard };
}

/**
 * Create the recovery phrase display message.
 */
export function recoveryPhraseMessage(formattedPhrase: string): { text: string; keyboard: InlineKeyboard } {
  const text =
    '📝 Step 2 of 4: Your Recovery Phrase\n\n' +
    'These 24 words can restore your wallet if anything goes wrong.\n\n' +
    '⚠️ CRITICAL — Write these down NOW on paper:\n\n' +
    '```\n' + formattedPhrase + '\n```\n\n' +
    '🚨 This is shown ONCE. Never share it. Never screenshot it.';

  const keyboard = inlineRow(
    { text: '✅ I\'ve Written It Down', callback: 'doge:onboard:phrase_saved' }
  );

  return { text, keyboard };
}

/**
 * Create the verification prompt message.
 */
export function verificationPromptMessage(indices: number[]): string {
  return (
    '🔍 Step 3 of 4: Let\'s Verify\n\n' +
    'To make sure you saved it correctly, please type these words:\n\n' +
    `Word #${indices[0]}: ___\n` +
    `Word #${indices[1]}: ___\n` +
    `Word #${indices[2]}: ___\n\n` +
    '📝 Type all three words separated by spaces:'
  );
}

/**
 * Create the verification failure message.
 */
export function verificationFailedMessage(
  mismatches: Array<{ index: number; expected: string; provided: string }>
): { text: string; keyboard: InlineKeyboard } {
  let details = 'Mismatches:\n';
  for (const m of mismatches) {
    details += `• Word #${m.index}: expected "${m.expected}"`;
    if (m.provided) {
      details += `, got "${m.provided}"`;
    } else {
      details += ' (missing)';
    }
    details += '\n';
  }

  const text =
    '❌ Verification Failed\n\n' +
    'That doesn\'t match. Please check your written copy.\n\n' +
    details + '\n' +
    'Let\'s try again — double-check your backup.';

  const keyboard = inlineRow(
    { text: '🔄 Show Phrase Again', callback: 'doge:onboard:phrase_show_again' },
    { text: '✏️ Try Again', callback: 'doge:onboard:verify_retry' }
  );

  return { text, keyboard };
}

/**
 * Create the spending limits prompt message.
 */
export function limitsPromptMessage(): { text: string; keyboard: InlineKeyboard } {
  const text =
    '⚙️ Step 4 of 4: Spending Limits\n\n' +
    'How much can I spend automatically without asking you?\n\n' +
    '📊 Recommended for beginners:\n' +
    '• Auto-approve: Up to 10 DOGE (~$1) per transaction\n' +
    '• Notify + wait: 10-100 DOGE\n' +
    '• Always ask: Over 100 DOGE\n\n' +
    'You can change this later with /wallet settings.';

  const keyboard = inlineGrid([
    [
      { text: '👍 Use Recommended (10 DOGE)', callback: 'doge:onboard:limits:recommended' },
    ],
    [
      { text: '🔧 Customize', callback: 'doge:onboard:limits:custom' },
    ],
  ]);

  return { text, keyboard };
}

/**
 * Create the custom limits selection message.
 */
export function customLimitsMessage(): { text: string; keyboard: InlineKeyboard } {
  const text =
    '⚙️ Custom Spending Limit\n\n' +
    'Set your auto-approve limit (transactions below this go through automatically):';

  const keyboard = inlineGrid([
    [
      { text: '1 DOGE', callback: 'doge:onboard:limits:1' },
      { text: '5 DOGE', callback: 'doge:onboard:limits:5' },
      { text: '10 DOGE', callback: 'doge:onboard:limits:10' },
    ],
    [
      { text: '25 DOGE', callback: 'doge:onboard:limits:25' },
      { text: '🚫 None (always ask)', callback: 'doge:onboard:limits:0' },
    ],
  ]);

  return { text, keyboard };
}

/**
 * Create the completion message.
 */
export function completionMessage(address: string): { text: string; keyboard: InlineKeyboard } {
  const text =
    '🎉 Your DOGE Wallet is Ready!\n\n' +
    '📬 Your receiving address:\n' +
    `\`${address}\`\n\n` +
    'Send DOGE to this address to fund your wallet.\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '📋 Quick commands:\n' +
    '• /balance — Check your balance\n' +
    '• /send <address> <amount> — Send DOGE\n' +
    '• /wallet — Wallet dashboard\n\n' +
    '💡 Tip: Start with a small test deposit (~10 DOGE)\n\n' +
    'Much wallet. Very ready. Wow. 🐕';

  const keyboard = inlineRow(
    { text: '📊 View Dashboard', callback: 'doge:dashboard' }
  );

  return { text, keyboard };
}

/**
 * Create the resume prompt for abandoned sessions.
 */
export function resumePromptMessage(): { text: string; keyboard: InlineKeyboard } {
  const text =
    '👋 Looks like you started setting up but didn\'t finish.\n\n' +
    'Would you like to continue where you left off?';

  const keyboard = inlineRow(
    { text: '▶️ Resume Setup', callback: 'doge:onboard:resume' },
    { text: '🔄 Start Over', callback: 'doge:onboard:restart' }
  );

  return { text, keyboard };
}
