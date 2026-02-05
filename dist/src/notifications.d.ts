/**
 * DOGE Wallet — Notification System
 *
 * Sends wallet event notifications via Telegram (or other channels).
 * All methods are fire-and-forget — errors are caught and logged, never crash the wallet.
 * Respects configurable notification level: "all" | "important" | "critical".
 *
 * Much notify. Very aware. Wow. 🐕
 */
import type { NotificationsConfig } from "./types.js";
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
export declare const LOW_BALANCE_CALLBACKS: {
    readonly PREFIX: "doge:lowbal:";
    readonly DISMISS: "doge:lowbal:dismiss";
    /** Dynamic snooze - duration passed as parameter */
    readonly SNOOZE: "doge:lowbal:snooze";
};
export declare class WalletNotifier {
    private readonly config;
    private readonly log;
    private sendMessage;
    private sendRichMessage;
    constructor(config: NotificationsConfig, log?: (level: "info" | "warn" | "error", msg: string) => void);
    /**
     * Set the message-sending function. Called once the plugin's API is ready.
     */
    setSendMessage(fn: SendMessageFn): void;
    /**
     * Set the rich message-sending function (supports inline keyboards).
     */
    setSendRichMessage(fn: SendRichMessageFn): void;
    private send;
    /**
     * Send a rich message with optional inline keyboard.
     * Falls back to plain text if rich message sender isn't set.
     */
    private sendRich;
    /** Outbound send was broadcast successfully. Priority: normal (important+). */
    notifySend(details: TxNotifyDetails): Promise<void>;
    /** Incoming DOGE detected. Priority: normal (important+). */
    notifyReceive(details: TxNotifyDetails): Promise<void>;
    /** A send requires owner approval. Priority: high (always). */
    notifyApprovalNeeded(pending: {
        id: string;
        amountDoge: number;
        to: string;
        tier: string;
        reason?: string;
        usdValue?: number | null;
    }): Promise<void>;
    /** Transaction confirmation update. Priority: low (all only). */
    notifyConfirmation(txid: string, confirmations: number, details?: {
        amountDoge?: number;
        to?: string;
    }): Promise<void>;
    /** Balance dropped below threshold. Priority: normal (important+). */
    notifyLowBalance(balanceDoge: number, thresholdDoge: number, snoozeHours?: number, usdValue?: number | null): Promise<void>;
    /** Spending policy blocked a send. Priority: high (always). */
    notifyPolicyBlock(reason: string): Promise<void>;
    /** Wallet frozen. Priority: high (always). */
    notifyFreeze(): Promise<void>;
    /** Wallet unfrozen. Priority: high (always). */
    notifyUnfreeze(): Promise<void>;
    /** Non-fatal error worth knowing about. Priority: high (important+ and critical). */
    notifyError(error: string): Promise<void>;
}
//# sourceMappingURL=notifications.d.ts.map