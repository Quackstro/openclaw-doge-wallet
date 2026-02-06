/**
 * DOGE Wallet — Pending Approval Queue
 *
 * Manages a persistent queue of pending send approvals.
 * Survives plugin restarts by persisting to disk.
 * Approvals expire after 24 hours.
 *
 * Much queue. Very pending. Wow. 🐕
 */
import type { TierName, SpendAction } from "./engine.js";
export interface PendingApproval {
    /** Unique ID for this approval request */
    id: string;
    /** Recipient DOGE address */
    to: string;
    /** Amount in koinu */
    amount: number;
    /** Amount in DOGE (for display) */
    amountDoge: number;
    /** Reason for the send */
    reason: string;
    /** Which tier matched */
    tier: TierName;
    /** Required action */
    action: SpendAction;
    /** When the approval was created */
    createdAt: string;
    /** When the approval expires */
    expiresAt: string;
    /** Auto-action on expiry: "approve" for delay tier, "deny" for others */
    autoAction: "approve" | "deny";
    /** Delay minutes for auto-approval */
    delayMinutes?: number;
    /** Current status */
    status: "pending" | "approved" | "denied" | "expired" | "executed";
    /** Who approved/denied */
    resolvedBy?: string;
    /** When it was resolved */
    resolvedAt?: string;
    /** Telegram message ID for inline button tracking */
    telegramMessageId?: string;
}
export declare class ApprovalQueue {
    private readonly filePath;
    private readonly log;
    private readonly ownerId;
    private pending;
    constructor(dataDir: string, ownerId?: string, log?: (level: "info" | "warn" | "error", msg: string) => void);
    /**
     * Queue a send request for approval.
     *
     * @returns The pending approval ID
     */
    queueForApproval(params: {
        to: string;
        amount: number;
        amountDoge: number;
        reason: string;
        tier: TierName;
        action: SpendAction;
        delayMinutes?: number;
    }): PendingApproval;
    /**
     * Get all pending approvals.
     */
    getPending(): PendingApproval[];
    /**
     * Get a specific pending approval by ID.
     */
    get(id: string): PendingApproval | undefined;
    /**
     * Approve a pending send.
     *
     * @returns The approved entry, or undefined if not found/already resolved
     */
    approve(id: string, by?: string): PendingApproval | undefined;
    /**
     * Deny a pending send.
     *
     * @returns The denied entry, or undefined if not found/already resolved
     */
    deny(id: string, by?: string): PendingApproval | undefined;
    /**
     * Mark an approved entry as executed (after successful broadcast).
     */
    markExecuted(id: string): void;
    /**
     * Set the Telegram message ID for a pending approval (for inline button tracking).
     */
    setTelegramMessageId(id: string, messageId: string): void;
    /**
     * Process expired approvals — auto-approve or auto-deny based on tier config.
     *
     * @returns Array of expired entries that were auto-approved
     */
    expire(): PendingApproval[];
    /**
     * Clean up old resolved entries (keep last 100).
     */
    cleanup(): void;
    load(): Promise<void>;
    private save;
}
//# sourceMappingURL=approval.d.ts.map