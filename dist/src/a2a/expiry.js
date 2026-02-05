/**
 * DOGE Wallet — Invoice Expiry & Cleanup
 *
 * Mark expired invoices and clean up old records.
 * Much expire. Very cleanup. Wow. 🐕
 */
import { MAX_STORED_INVOICES } from "./types.js";
// ============================================================================
// Expiry Manager
// ============================================================================
export class ExpiryManager {
    invoiceManager;
    maxInvoices;
    log;
    constructor(invoiceManager, config = {}) {
        this.invoiceManager = invoiceManager;
        this.maxInvoices = config.maxInvoices ?? MAX_STORED_INVOICES;
        this.log = config.log ?? (() => { });
    }
    /**
     * Mark all pending invoices that have passed their expiry time.
     * Does not remove invoices — just updates their status.
     *
     * @returns List of invoice IDs that were expired
     */
    async expirePending() {
        const pending = this.invoiceManager.listInvoices({ status: "pending" });
        const now = Date.now();
        const expiredIds = [];
        for (const invoice of pending) {
            const expiresAt = new Date(invoice.expiresAt).getTime();
            if (expiresAt < now) {
                await this.invoiceManager.markInvoiceExpired(invoice.invoiceId);
                expiredIds.push(invoice.invoiceId);
            }
        }
        if (expiredIds.length > 0) {
            this.log("info", `doge-wallet: expired ${expiredIds.length} pending invoice(s)`);
        }
        return expiredIds;
    }
    /**
     * Clean up old invoices, keeping only the most recent ones.
     *
     * Keeps:
     * - All pending invoices (never auto-delete waiting payments)
     * - Most recent N invoices (by creation time)
     *
     * @returns List of invoice IDs that were removed
     */
    async cleanup() {
        const all = this.invoiceManager.listInvoices();
        // Don't cleanup if under limit
        if (all.length <= this.maxInvoices) {
            return [];
        }
        // Separate pending from resolved
        const pending = all.filter((inv) => inv.status === "pending");
        const resolved = all.filter((inv) => inv.status !== "pending");
        // Calculate how many resolved invoices we can keep
        const maxResolved = Math.max(0, this.maxInvoices - pending.length);
        // Resolved are already sorted by creation time (newest first)
        // So we remove the oldest ones (at the end)
        const toRemove = resolved.slice(maxResolved);
        const removedIds = [];
        for (const invoice of toRemove) {
            // Mark as expired if still pending (shouldn't happen but safety first)
            if (invoice.status === "pending") {
                await this.invoiceManager.markInvoiceExpired(invoice.invoiceId);
            }
            // Note: We don't have a delete method yet — we'll just leave them as expired
            // In a production system, you'd want to actually remove them from storage
            removedIds.push(invoice.invoiceId);
        }
        if (removedIds.length > 0) {
            this.log("info", `doge-wallet: marked ${removedIds.length} old invoice(s) for cleanup`);
        }
        return removedIds;
    }
    /**
     * Run full expiry and cleanup cycle.
     *
     * 1. Mark expired invoices
     * 2. Clean up old invoices beyond limit
     *
     * @returns Full cleanup result
     */
    async cleanupExpiredInvoices() {
        // Step 1: Expire pending invoices
        const expiredIds = await this.expirePending();
        // Step 2: Cleanup old invoices
        const removedIds = await this.cleanup();
        // Get remaining count
        const stats = this.invoiceManager.getStats();
        return {
            expiredCount: expiredIds.length,
            expiredIds,
            removedCount: removedIds.length,
            removedIds,
            remaining: stats.total,
        };
    }
    /**
     * Get a summary of invoice expiry status.
     */
    getExpirySummary() {
        const all = this.invoiceManager.listInvoices();
        const now = Date.now();
        const soon = now + 10 * 60 * 1000; // 10 minutes from now
        let pending = 0;
        let expiredSoon = 0;
        let totalExpired = 0;
        for (const invoice of all) {
            if (invoice.status === "expired") {
                totalExpired++;
            }
            else if (invoice.status === "pending") {
                pending++;
                const expiresAt = new Date(invoice.expiresAt).getTime();
                if (expiresAt < soon) {
                    expiredSoon++;
                }
            }
        }
        return { pending, expiredSoon, totalExpired };
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create an expiry manager for the given invoice manager.
 */
export function createExpiryManager(invoiceManager, config = {}) {
    return new ExpiryManager(invoiceManager, config);
}
/**
 * Convenience function for one-time cleanup.
 */
export async function cleanupExpiredInvoices(invoiceManager, config = {}) {
    const manager = createExpiryManager(invoiceManager, config);
    return manager.cleanupExpiredInvoices();
}
//# sourceMappingURL=expiry.js.map