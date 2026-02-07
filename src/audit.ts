/**
 * DOGE Wallet — Audit Trail Foundation
 *
 * Every financial event is logged permanently. This is not optional.
 * Phase 0: JSON file-based audit log (upgraded to LanceDB in later phases).
 *
 * Much audit. Very transparent. Wow. 🐕
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { secureAppendFile } from "./secure-fs.js";
import { randomUUID } from "node:crypto";
import type { AuditEntry, AuditAction } from "./types.js";

export class AuditLog {
  private filePath: string;
  private log: (level: "info" | "warn" | "error", msg: string) => void;
  /** In-memory cache of received txids → audit entry for fast dedup (avoids reading full audit file) */
  private seenReceiveByTxid: Map<string, AuditEntry> = new Map();
  private seenReceiveTxidsLoaded = false;

  constructor(
    dataDir: string,
    log?: (level: "info" | "warn" | "error", msg: string) => void,
  ) {
    this.filePath = join(dataDir, "audit", "audit.jsonl");
    this.log = log ?? (() => {});
  }

  /** Load receive txids into memory cache (called once on first receive check) */
  private async loadSeenReceiveTxids(): Promise<void> {
    if (this.seenReceiveTxidsLoaded) return;
    try {
      const all = await this.getAuditLog(10000);
      for (const e of all) {
        if (e.action === "receive" && e.txid) {
          this.seenReceiveByTxid.set(e.txid, e);
        }
      }
    } catch { /* start fresh if read fails */ }
    this.seenReceiveTxidsLoaded = true;
  }

  /** Log an audit entry — appends to the JSONL file */
  async logAudit(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry> {
    const fullEntry: AuditEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    try {
      // Append as JSONL (one JSON object per line) — secure permissions enforced
      const line = JSON.stringify(fullEntry) + "\n";
      await secureAppendFile(this.filePath, line);

      this.log("info", `doge-wallet: audit: ${fullEntry.action} — ${fullEntry.reason ?? "no reason"}`);
    } catch (err: any) {
      // Audit logging should never crash the wallet — log and continue
      this.log("error", `doge-wallet: audit write failed: ${err.message ?? err}`);
    }

    return fullEntry;
  }

  /** Read recent audit entries */
  async getAuditLog(limit: number = 20): Promise<AuditEntry[]> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const entries: AuditEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as AuditEntry);
        } catch {
          // Skip malformed lines
        }
      }

      // Return most recent entries
      return entries.slice(-limit).reverse();
    } catch (err: any) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // No audit log yet — that's fine
      }
      this.log("error", `doge-wallet: audit read failed: ${err.message ?? err}`);
      return [];
    }
  }

  /** Get audit entries filtered by action type */
  async getByAction(action: AuditAction, limit: number = 20): Promise<AuditEntry[]> {
    const all = await this.getAuditLog(1000); // Read more to filter
    return all.filter((e) => e.action === action).slice(0, limit);
  }

  /** Get audit entries for a specific address */
  async getByAddress(address: string, limit: number = 20): Promise<AuditEntry[]> {
    const all = await this.getAuditLog(1000);
    return all.filter((e) => e.address === address).slice(0, limit);
  }

  /** Get the total number of audit entries */
  async count(): Promise<number> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      return content.trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  // --------------------------------------------------------------------------
  // Phase 3: Transaction-specific audit helpers
  // --------------------------------------------------------------------------

  /** Log a send transaction */
  async logSend(
    txid: string,
    to: string,
    amountKoinu: number,
    feeKoinu: number,
    tier: string,
    status: string,
    reason?: string,
  ): Promise<AuditEntry> {
    return this.logAudit({
      action: "send",
      txid,
      address: to,
      amount: amountKoinu,
      fee: feeKoinu,
      tier,
      reason: reason ?? `Send ${amountKoinu / 1e8} DOGE to ${to} — status: ${status}`,
      initiatedBy: "agent",
      metadata: { status },
    });
  }

  /** Log an approval decision */
  async logApproval(
    pendingId: string,
    approved: boolean,
    by: string,
    amountKoinu?: number,
    address?: string,
  ): Promise<AuditEntry> {
    return this.logAudit({
      action: approved ? "approve" : "deny",
      approvalId: pendingId,
      amount: amountKoinu,
      address,
      reason: `Approval ${pendingId} ${approved ? "approved" : "denied"} by ${by}`,
      initiatedBy: by === "owner" ? "owner" : by === "system" || by === "auto-timeout" ? "system" : "agent",
    });
  }

  /** Log a policy evaluation */
  async logPolicyCheck(
    amountKoinu: number,
    tier: string,
    action: string,
    reason?: string,
  ): Promise<AuditEntry> {
    return this.logAudit({
      action: "balance_check", // reuse existing action type for policy checks
      amount: amountKoinu,
      tier,
      reason: reason ?? `Policy check: tier=${tier}, action=${action}`,
      initiatedBy: "system",
      metadata: { policyAction: action },
    });
  }

  /** Log a freeze/unfreeze event */
  async logFreeze(frozen: boolean, by: string): Promise<AuditEntry> {
    return this.logAudit({
      action: frozen ? "freeze" : "unfreeze",
      reason: `Wallet ${frozen ? "frozen" : "unfrozen"} by ${by}`,
      initiatedBy: by === "owner" ? "owner" : "system",
    });
  }

  /** Log a receive transaction (deduplicated by txid using in-memory cache) */
  async logReceive(
    txid: string,
    fromAddress: string,
    amountKoinu: number,
    confirmations: number,
  ): Promise<AuditEntry> {
    // Load cache on first call (one-time file read)
    await this.loadSeenReceiveTxids();

    // Fast in-memory dedup check
    if (this.seenReceiveByTxid.has(txid)) {
      this.log("info", `doge-wallet: audit: receive ${txid} already logged — skipping duplicate`);
      return this.seenReceiveByTxid.get(txid)!;
    }

    const entry = await this.logAudit({
      action: "receive",
      txid,
      address: fromAddress,
      amount: amountKoinu,
      reason: `Received ${amountKoinu / 1e8} DOGE from ${fromAddress} (${confirmations} conf)`,
      initiatedBy: "external",
      metadata: { confirmations },
    });

    // Cache for future dedup
    this.seenReceiveByTxid.set(txid, entry);
    return entry;
  }

  /** Get recent send transactions for history display */
  async getSendHistory(limit: number = 20): Promise<AuditEntry[]> {
    return this.getByAction("send", limit);
  }

  /** Get recent receive transactions */
  async getReceiveHistory(limit: number = 20): Promise<AuditEntry[]> {
    return this.getByAction("receive", limit);
  }

  /** Get both sends and receives sorted by timestamp (newest first) */
  async getFullHistory(limit: number = 20): Promise<AuditEntry[]> {
    const all = await this.getAuditLog(1000);
    return all
      .filter((e) => e.action === "send" || e.action === "receive")
      .slice(0, limit);
  }
}
