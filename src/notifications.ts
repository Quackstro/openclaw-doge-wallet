/**
 * DOGE Wallet — Notification System
 *
 * Sends wallet event notifications via Telegram (or other channels).
 * All methods are fire-and-forget — errors are caught and logged, never crash the wallet.
 * Respects configurable notification level: "all" | "important" | "critical".
 *
 * Much notify. Very aware. Wow. 🐕
 */

import type { NotificationsConfig, NotificationLevel } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export type SendMessageFn = (message: string) => Promise<void>;

/** Inline keyboard button (Telegram format) */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

/** Message with optional inline keyboard */
export interface RichMessage {
  text: string;
  keyboard?: InlineKeyboard;
}

/** Extended send function that supports inline keyboards */
export type SendRichMessageFn = (message: RichMessage) => Promise<void>;

export interface TxNotifyDetails {
  txid: string;
  address: string;
  amountDoge: number;
  feeDoge?: number;
  usdValue?: number | null;
}

// ============================================================================
// Notification level → event priority mapping
// ============================================================================

type EventPriority = "low" | "normal" | "high";

/**
 * Whether a given event priority is included in the configured level.
 *
 * - "all":       low, normal, high
 * - "important": normal, high
 * - "critical":  high only
 */
function shouldNotify(level: NotificationLevel, priority: EventPriority): boolean {
  switch (level) {
    case "all":
      return true;
    case "important":
      return priority === "normal" || priority === "high";
    case "critical":
      return priority === "high";
    default:
      return priority === "normal" || priority === "high";
  }
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtDoge(amount: number): string {
  return amount.toFixed(2);
}

function fmtDogeUsd(amount: number, usd?: number | null): string {
  if (usd != null) {
    return `${fmtDoge(amount)} DOGE (~$${usd.toFixed(2)})`;
  }
  return `${fmtDoge(amount)} DOGE`;
}

function truncAddr(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ============================================================================
// Low Balance Alert Callback Patterns
// ============================================================================

export const LOW_BALANCE_CALLBACKS = {
  PREFIX: 'doge:lowbal:',
  DISMISS: 'doge:lowbal:dismiss',
  /** Dynamic snooze - duration passed as parameter */
  SNOOZE: 'doge:lowbal:snooze',
} as const;

// ============================================================================
// WalletNotifier
// ============================================================================

export class WalletNotifier {
  private readonly config: NotificationsConfig;
  private readonly log: (level: "info" | "warn" | "error", msg: string) => void;
  private sendMessage: SendMessageFn | null = null;
  private sendRichMessage: SendRichMessageFn | null = null;

  constructor(
    config: NotificationsConfig,
    log?: (level: "info" | "warn" | "error", msg: string) => void,
  ) {
    this.config = config;
    this.log = log ?? (() => {});
  }

  /**
   * Set the message-sending function. Called once the plugin's API is ready.
   */
  setSendMessage(fn: SendMessageFn): void {
    this.sendMessage = fn;
  }

  /**
   * Set the rich message-sending function (supports inline keyboards).
   */
  setSendRichMessage(fn: SendRichMessageFn): void {
    this.sendRichMessage = fn;
  }

  // --------------------------------------------------------------------------
  // Private: fire-and-forget send
  // --------------------------------------------------------------------------

  private async send(
    message: string,
    priority: EventPriority,
  ): Promise<void> {
    try {
      if (!this.config.enabled) return;
      if (!shouldNotify(this.config.level, priority)) return;
      if (!this.sendMessage) {
        this.log("warn", "doge-wallet: notifier has no sendMessage fn set — dropping notification");
        return;
      }
      await this.sendMessage(message);
    } catch (err: unknown) {
      // Non-blocking — log and move on
      this.log("warn", `doge-wallet: notification send failed: ${(err as Error).message ?? err}`);
    }
  }

  /**
   * Send a rich message with optional inline keyboard.
   * Falls back to plain text if rich message sender isn't set.
   */
  private async sendRich(
    message: RichMessage,
    priority: EventPriority,
  ): Promise<void> {
    try {
      if (!this.config.enabled) return;
      if (!shouldNotify(this.config.level, priority)) return;

      // Try rich message first
      if (this.sendRichMessage) {
        await this.sendRichMessage(message);
        return;
      }

      // Fallback to plain text
      if (this.sendMessage) {
        await this.sendMessage(message.text);
        return;
      }

      this.log("warn", "doge-wallet: notifier has no sendMessage fn set — dropping notification");
    } catch (err: unknown) {
      // Non-blocking — log and move on
      this.log("warn", `doge-wallet: notification send failed: ${(err as Error).message ?? err}`);
    }
  }

  // --------------------------------------------------------------------------
  // Public notification methods
  // --------------------------------------------------------------------------

  /** Outbound send was broadcast successfully. Priority: normal (important+). */
  async notifySend(details: TxNotifyDetails): Promise<void> {
    const msg =
      `🐕 Sent ${fmtDogeUsd(details.amountDoge, details.usdValue)} to ${truncAddr(details.address)}\n` +
      (details.feeDoge != null ? `⛽ Fee: ${fmtDoge(details.feeDoge)} DOGE\n` : "") +
      `🔗 TX: ${details.txid.slice(0, 16)}…\n` +
      `Much spend. Wow.`;
    await this.send(msg, "normal");
  }

  /** Incoming DOGE detected. Priority: normal (important+). */
  async notifyReceive(details: TxNotifyDetails): Promise<void> {
    const msg =
      `🐕 Received ${fmtDogeUsd(details.amountDoge, details.usdValue)}!\n` +
      `📥 From: ${truncAddr(details.address)}\n` +
      `🔗 TX: ${details.txid.slice(0, 16)}…\n` +
      `Such income. Very rich. Wow.`;
    await this.send(msg, "normal");
  }

  /** A send requires owner approval. Priority: high (always). */
  async notifyApprovalNeeded(pending: {
    id: string;
    amountDoge: number;
    to: string;
    tier: string;
    reason?: string;
    usdValue?: number | null;
  }): Promise<void> {
    const shortId = pending.id.slice(0, 8);
    const msg =
      `🔐 Approval needed\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 ${fmtDogeUsd(pending.amountDoge, pending.usdValue)} → ${truncAddr(pending.to)}\n` +
      `📝 Tier: ${pending.tier}\n` +
      (pending.reason ? `📋 Reason: ${pending.reason}\n` : "") +
      `\nReply /wallet approve ${shortId} or /wallet deny ${shortId}`;
    await this.send(msg, "high");
  }

  /** Transaction confirmation update. Priority: low (all only). */
  async notifyConfirmation(
    txid: string,
    confirmations: number,
    details?: { amountDoge?: number; to?: string },
  ): Promise<void> {
    const target = confirmations >= 6 ? 6 : 6;
    const done = confirmations >= 6;
    const emoji = done ? "✅" : "🔄";
    let msg = `${emoji} Tx ${done ? "confirmed" : "confirming"} (${confirmations}/${target})`;
    if (details?.amountDoge != null) {
      msg += ` — ${fmtDoge(details.amountDoge)} DOGE`;
    }
    if (details?.to) {
      msg += ` to ${truncAddr(details.to)}`;
    }
    msg += `\n🔗 ${txid.slice(0, 16)}…`;
    if (done) msg += `\nMuch confirmed. Very final. Wow.`;
    await this.send(msg, "low");
  }

  /** Balance dropped below threshold. Priority: normal (important+). */
  async notifyLowBalance(
    balanceDoge: number,
    thresholdDoge: number,
    snoozeHours?: number,
    usdValue?: number | null,
  ): Promise<void> {
    const text =
      `⚠️ Low DOGE Balance\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 Balance: ${fmtDogeUsd(balanceDoge, usdValue)}\n` +
      `📊 Threshold: ${fmtDoge(thresholdDoge)} DOGE\n\n` +
      `Much empty. Consider topping up. 🐕`;

    // Default snooze to 12 hours if not specified
    const snoozeH = snoozeHours ?? 12;
    const snoozeLabel = snoozeH >= 24 ? `${Math.round(snoozeH / 24)}d` : `${snoozeH}h`;

    const keyboard: InlineKeyboard = [
      [
        { text: '✅ Dismiss', callback_data: LOW_BALANCE_CALLBACKS.DISMISS },
        { text: `💤 Snooze ${snoozeLabel}`, callback_data: `${LOW_BALANCE_CALLBACKS.SNOOZE}:${snoozeH}` },
      ],
    ];

    await this.sendRich({ text, keyboard }, "normal");
  }

  /** Spending policy blocked a send. Priority: high (always). */
  async notifyPolicyBlock(reason: string): Promise<void> {
    const msg = `🚫 Send blocked: ${reason}`;
    await this.send(msg, "high");
  }

  /** Wallet frozen. Priority: high (always). */
  async notifyFreeze(): Promise<void> {
    const msg =
      `🧊 Wallet FROZEN\n` +
      `All outbound transactions are now blocked.\n` +
      `Use /wallet unfreeze to resume.`;
    await this.send(msg, "high");
  }

  /** Wallet unfrozen. Priority: high (always). */
  async notifyUnfreeze(): Promise<void> {
    const msg =
      `🔥 Wallet UNFROZEN\n` +
      `Normal spending policy restored. Sends are active again.`;
    await this.send(msg, "high");
  }

  /** Non-fatal error worth knowing about. Priority: high (important+ and critical). */
  async notifyError(error: string): Promise<void> {
    const msg = `⚠️ DOGE Wallet Error: ${error}`;
    await this.send(msg, "high");
  }
}
