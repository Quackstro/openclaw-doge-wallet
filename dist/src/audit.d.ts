/**
 * DOGE Wallet — Audit Trail Foundation
 *
 * Every financial event is logged permanently. This is not optional.
 * Phase 0: JSON file-based audit log (upgraded to LanceDB in later phases).
 *
 * Much audit. Very transparent. Wow. 🐕
 */
import type { AuditEntry, AuditAction } from "./types.js";
export declare class AuditLog {
    private filePath;
    private log;
    constructor(dataDir: string, log?: (level: "info" | "warn" | "error", msg: string) => void);
    /** Log an audit entry — appends to the JSONL file */
    logAudit(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry>;
    /** Read recent audit entries */
    getAuditLog(limit?: number): Promise<AuditEntry[]>;
    /** Get audit entries filtered by action type */
    getByAction(action: AuditAction, limit?: number): Promise<AuditEntry[]>;
    /** Get audit entries for a specific address */
    getByAddress(address: string, limit?: number): Promise<AuditEntry[]>;
    /** Get the total number of audit entries */
    count(): Promise<number>;
    /** Log a send transaction */
    logSend(txid: string, to: string, amountKoinu: number, feeKoinu: number, tier: string, status: string, reason?: string): Promise<AuditEntry>;
    /** Log an approval decision */
    logApproval(pendingId: string, approved: boolean, by: string, amountKoinu?: number, address?: string): Promise<AuditEntry>;
    /** Log a policy evaluation */
    logPolicyCheck(amountKoinu: number, tier: string, action: string, reason?: string): Promise<AuditEntry>;
    /** Log a freeze/unfreeze event */
    logFreeze(frozen: boolean, by: string): Promise<AuditEntry>;
    /** Get recent send transactions for history display */
    getSendHistory(limit?: number): Promise<AuditEntry[]>;
}
//# sourceMappingURL=audit.d.ts.map