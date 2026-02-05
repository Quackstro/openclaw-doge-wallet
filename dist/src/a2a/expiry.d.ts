/**
 * DOGE Wallet — Invoice Expiry & Cleanup
 *
 * Mark expired invoices and clean up old records.
 * Much expire. Very cleanup. Wow. 🐕
 */
import type { InvoiceManager } from "./invoice.js";
export interface ExpiryCleanupResult {
    /** Number of invoices marked as expired */
    expiredCount: number;
    /** Invoice IDs that were expired */
    expiredIds: string[];
    /** Number of invoices removed (cleanup) */
    removedCount: number;
    /** Invoice IDs that were removed */
    removedIds: string[];
    /** Total invoices remaining */
    remaining: number;
}
export interface ExpiryConfig {
    /** Maximum invoices to keep (default: 100) */
    maxInvoices?: number;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
export declare class ExpiryManager {
    private invoiceManager;
    private maxInvoices;
    private log;
    constructor(invoiceManager: InvoiceManager, config?: ExpiryConfig);
    /**
     * Mark all pending invoices that have passed their expiry time.
     * Does not remove invoices — just updates their status.
     *
     * @returns List of invoice IDs that were expired
     */
    expirePending(): Promise<string[]>;
    /**
     * Clean up old invoices, keeping only the most recent ones.
     *
     * Keeps:
     * - All pending invoices (never auto-delete waiting payments)
     * - Most recent N invoices (by creation time)
     *
     * @returns List of invoice IDs that were removed
     */
    cleanup(): Promise<string[]>;
    /**
     * Run full expiry and cleanup cycle.
     *
     * 1. Mark expired invoices
     * 2. Clean up old invoices beyond limit
     *
     * @returns Full cleanup result
     */
    cleanupExpiredInvoices(): Promise<ExpiryCleanupResult>;
    /**
     * Get a summary of invoice expiry status.
     */
    getExpirySummary(): {
        pending: number;
        expiredSoon: number;
        totalExpired: number;
    };
}
/**
 * Create an expiry manager for the given invoice manager.
 */
export declare function createExpiryManager(invoiceManager: InvoiceManager, config?: ExpiryConfig): ExpiryManager;
/**
 * Convenience function for one-time cleanup.
 */
export declare function cleanupExpiredInvoices(invoiceManager: InvoiceManager, config?: ExpiryConfig): Promise<ExpiryCleanupResult>;
//# sourceMappingURL=expiry.d.ts.map