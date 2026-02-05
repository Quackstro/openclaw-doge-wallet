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
export class AuditLog {
    filePath;
    log;
    constructor(dataDir, log) {
        this.filePath = join(dataDir, "audit", "audit.jsonl");
        this.log = log ?? (() => { });
    }
    /** Log an audit entry — appends to the JSONL file */
    async logAudit(entry) {
        const fullEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            ...entry,
        };
        try {
            // Append as JSONL (one JSON object per line) — secure permissions enforced
            const line = JSON.stringify(fullEntry) + "\n";
            await secureAppendFile(this.filePath, line);
            this.log("info", `doge-wallet: audit: ${fullEntry.action} — ${fullEntry.reason ?? "no reason"}`);
        }
        catch (err) {
            // Audit logging should never crash the wallet — log and continue
            this.log("error", `doge-wallet: audit write failed: ${err.message ?? err}`);
        }
        return fullEntry;
    }
    /** Read recent audit entries */
    async getAuditLog(limit = 20) {
        try {
            const content = await readFile(this.filePath, "utf-8");
            const lines = content.trim().split("\n").filter(Boolean);
            const entries = [];
            for (const line of lines) {
                try {
                    entries.push(JSON.parse(line));
                }
                catch {
                    // Skip malformed lines
                }
            }
            // Return most recent entries
            return entries.slice(-limit).reverse();
        }
        catch (err) {
            if (err.code === "ENOENT") {
                return []; // No audit log yet — that's fine
            }
            this.log("error", `doge-wallet: audit read failed: ${err.message ?? err}`);
            return [];
        }
    }
    /** Get audit entries filtered by action type */
    async getByAction(action, limit = 20) {
        const all = await this.getAuditLog(1000); // Read more to filter
        return all.filter((e) => e.action === action).slice(0, limit);
    }
    /** Get audit entries for a specific address */
    async getByAddress(address, limit = 20) {
        const all = await this.getAuditLog(1000);
        return all.filter((e) => e.address === address).slice(0, limit);
    }
    /** Get the total number of audit entries */
    async count() {
        try {
            const content = await readFile(this.filePath, "utf-8");
            return content.trim().split("\n").filter(Boolean).length;
        }
        catch {
            return 0;
        }
    }
    // --------------------------------------------------------------------------
    // Phase 3: Transaction-specific audit helpers
    // --------------------------------------------------------------------------
    /** Log a send transaction */
    async logSend(txid, to, amountKoinu, feeKoinu, tier, status, reason) {
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
    async logApproval(pendingId, approved, by, amountKoinu, address) {
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
    async logPolicyCheck(amountKoinu, tier, action, reason) {
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
    async logFreeze(frozen, by) {
        return this.logAudit({
            action: frozen ? "freeze" : "unfreeze",
            reason: `Wallet ${frozen ? "frozen" : "unfrozen"} by ${by}`,
            initiatedBy: by === "owner" ? "owner" : "system",
        });
    }
    /** Get recent send transactions for history display */
    async getSendHistory(limit = 20) {
        return this.getByAction("send", limit);
    }
}
//# sourceMappingURL=audit.js.map