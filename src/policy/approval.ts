/**
 * DOGE Wallet — Pending Approval Queue
 *
 * Manages a persistent queue of pending send approvals.
 * Survives plugin restarts by persisting to disk.
 * Approvals expire after 24 hours.
 *
 * Much queue. Very pending. Wow. 🐕
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TierName, SpendAction } from "./engine.js";

// ============================================================================
// Types
// ============================================================================

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

interface ApprovalState {
  version: 1;
  pending: PendingApproval[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default expiry for approvals: 24 hours */
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// ApprovalQueue
// ============================================================================

export class ApprovalQueue {
  private readonly filePath: string;
  private readonly log: (level: "info" | "warn" | "error", msg: string) => void;
  // SECURITY [H-3]: Verify caller identity before approval
  private readonly ownerId: string;

  private pending: Map<string, PendingApproval> = new Map();

  constructor(
    dataDir: string,
    ownerId?: string,
    log?: (level: "info" | "warn" | "error", msg: string) => void,
  ) {
    this.filePath = join(dataDir, "pending.json");
    // SECURITY [H-3]: Fail-closed — if no ownerId configured, no caller can match
    this.ownerId = ownerId ?? "<OWNER_NOT_CONFIGURED>";
    this.log = log ?? (() => {});
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

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
  }): PendingApproval {
    const id = randomUUID();
    const now = new Date();

    // For delay tiers, auto-approve after the delay period
    // For approval tiers, auto-deny after 24h
    const isDelay = params.action === "delay";
    const expiryMs = isDelay
      ? (params.delayMinutes ?? 5) * 60 * 1000
      : DEFAULT_EXPIRY_MS;

    const entry: PendingApproval = {
      id,
      to: params.to,
      amount: params.amount,
      amountDoge: params.amountDoge,
      reason: params.reason,
      tier: params.tier,
      action: params.action,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiryMs).toISOString(),
      autoAction: isDelay ? "approve" : "deny",
      delayMinutes: params.delayMinutes,
      status: "pending",
    };

    this.pending.set(id, entry);
    this.save().catch(() => {});

    this.log("info", `doge-wallet: queued approval ${id} — ${params.amountDoge} DOGE to ${params.to}`);

    return entry;
  }

  /**
   * Get all pending approvals.
   */
  getPending(): PendingApproval[] {
    return Array.from(this.pending.values()).filter((p) => p.status === "pending");
  }

  /**
   * Get a specific pending approval by ID.
   */
  get(id: string): PendingApproval | undefined {
    return this.pending.get(id);
  }

  /**
   * Approve a pending send.
   *
   * @returns The approved entry, or undefined if not found/already resolved
   */
  // SECURITY [H-3]: Verify caller identity before approval
  approve(id: string, by: string = "unknown"): PendingApproval | undefined {
    // SECURITY [H-3]: Only the configured owner or system auto-approvals are allowed
    if (by !== this.ownerId && by !== "system:auto") {
      this.log("warn", `doge-wallet: approval ${id} rejected — unauthorized caller: ${by}`);
      return undefined;
    }
    const entry = this.pending.get(id);
    if (!entry || entry.status !== "pending") return undefined;

    entry.status = "approved";
    entry.resolvedBy = by;
    entry.resolvedAt = new Date().toISOString();

    this.save().catch(() => {});
    this.log("info", `doge-wallet: approval ${id} APPROVED by ${by}`);

    return entry;
  }

  /**
   * Deny a pending send.
   *
   * @returns The denied entry, or undefined if not found/already resolved
   */
  // SECURITY [H-3]: Verify caller identity before approval
  deny(id: string, by: string = "unknown"): PendingApproval | undefined {
    // SECURITY [H-3]: Only the configured owner or system auto-approvals are allowed
    if (by !== this.ownerId && by !== "system:auto") {
      this.log("warn", `doge-wallet: denial ${id} rejected — unauthorized caller: ${by}`);
      return undefined;
    }
    const entry = this.pending.get(id);
    if (!entry || entry.status !== "pending") return undefined;

    entry.status = "denied";
    entry.resolvedBy = by;
    entry.resolvedAt = new Date().toISOString();

    this.save().catch(() => {});
    this.log("info", `doge-wallet: approval ${id} DENIED by ${by}`);

    return entry;
  }

  /**
   * Mark an approved entry as executed (after successful broadcast).
   */
  markExecuted(id: string): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.status = "executed";
      this.save().catch(() => {});
    }
  }

  /**
   * Set the Telegram message ID for a pending approval (for inline button tracking).
   */
  setTelegramMessageId(id: string, messageId: string): void {
    const entry = this.pending.get(id);
    if (entry) {
      entry.telegramMessageId = messageId;
      this.save().catch(() => {});
    }
  }

  /**
   * Process expired approvals — auto-approve or auto-deny based on tier config.
   *
   * @returns Array of expired entries that were auto-approved
   */
  expire(): PendingApproval[] {
    const now = Date.now();
    const autoApproved: PendingApproval[] = [];

    for (const entry of this.pending.values()) {
      if (entry.status !== "pending") continue;

      const expiresAt = new Date(entry.expiresAt).getTime();
      if (now < expiresAt) continue;

      if (entry.autoAction === "approve") {
        entry.status = "approved";
        entry.resolvedBy = "auto-timeout";
        entry.resolvedAt = new Date().toISOString();
        autoApproved.push(entry);
        this.log("info", `doge-wallet: approval ${entry.id} auto-approved (timeout)`);
      } else {
        entry.status = "expired";
        entry.resolvedAt = new Date().toISOString();
        this.log("info", `doge-wallet: approval ${entry.id} expired`);
      }
    }

    if (autoApproved.length > 0) {
      this.save().catch(() => {});
    }

    return autoApproved;
  }

  /**
   * Clean up old resolved entries (keep last 100).
   */
  cleanup(): void {
    const all = Array.from(this.pending.entries());
    const resolved = all.filter(
      ([_, e]) => e.status !== "pending",
    );

    if (resolved.length > 100) {
      // Sort by resolvedAt, remove oldest
      resolved.sort(
        (a, b) =>
          new Date(a[1].resolvedAt ?? a[1].createdAt).getTime() -
          new Date(b[1].resolvedAt ?? b[1].createdAt).getTime(),
      );

      const toRemove = resolved.slice(0, resolved.length - 100);
      for (const [id] of toRemove) {
        this.pending.delete(id);
      }

      this.save().catch(() => {});
    }
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const state = JSON.parse(raw) as ApprovalState;

      if (state.version !== 1 || !Array.isArray(state.pending)) {
        this.log("warn", "doge-wallet: invalid approval state, starting fresh");
        return;
      }

      this.pending.clear();
      for (const entry of state.pending) {
        this.pending.set(entry.id, entry);
      }

      this.log(
        "info",
        `doge-wallet: approval queue loaded — ${this.getPending().length} pending`,
      );
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        this.log("warn", `doge-wallet: approval state read failed: ${e.message}`);
      }
    }
  }

  private async save(): Promise<void> {
    const state: ApprovalState = {
      version: 1,
      pending: Array.from(this.pending.values()),
    };

    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await writeFile(this.filePath, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
    } catch (err: unknown) {
      this.log("error", `doge-wallet: approval state write failed: ${(err as Error).message}`);
    }
  }
}
