/**
 * DOGE Wallet — Invoice Management
 *
 * Create, track, and manage A2A payment invoices.
 * Much invoice. Very track. Wow. 🐕
 */
import type { DogeInvoice, InvoiceStatus, InvoiceFilter } from "./types.js";
export interface CreateInvoiceOptions {
    /** Optional external reference ID */
    reference?: string;
    /** Custom expiry duration in milliseconds (default: 1 hour) */
    expiryMs?: number;
    /** Callback URL for payment notification */
    callbackUrl?: string;
    /** Auth token for callback */
    callbackToken?: string;
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
}
export interface InvoiceManagerConfig {
    /** Name of the agent/service */
    name: string;
    /** DOGE receiving address */
    address: string;
    /** Operator name (optional) */
    operator?: string;
    /** Data directory for storage */
    dataDir: string;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
export declare class InvoiceManager {
    private config;
    private filePath;
    private invoices;
    private log;
    /** Mutex for thread-safe invoice state changes */
    private invoiceMutex;
    constructor(config: InvoiceManagerConfig);
    /**
     * Create a new invoice.
     *
     * @param amount - Amount in DOGE
     * @param description - What this payment is for
     * @param options - Optional settings (expiry, callback, metadata)
     * @returns The created invoice
     */
    createInvoice(amount: number, description: string, options?: CreateInvoiceOptions): DogeInvoice;
    /**
     * Get an invoice by ID.
     *
     * @param invoiceId - The invoice ID to look up
     * @returns The invoice or null if not found
     */
    getInvoice(invoiceId: string): DogeInvoice | null;
    /**
     * Mark an invoice as paid.
     * Uses mutex to prevent race conditions in concurrent state changes.
     *
     * @param invoiceId - The invoice ID
     * @param txid - The transaction ID that paid this invoice
     * @returns Object with success status and the invoice
     */
    markInvoicePaid(invoiceId: string, txid: string): Promise<{
        success: boolean;
        invoice: DogeInvoice | null;
    }>;
    /**
     * Mark an invoice as cancelled.
     * Uses mutex to prevent race conditions in concurrent state changes.
     *
     * @param invoiceId - The invoice ID
     * @returns Object with success status and the invoice
     */
    markInvoiceCancelled(invoiceId: string): Promise<{
        success: boolean;
        invoice: DogeInvoice | null;
    }>;
    /**
     * Mark an invoice as expired.
     * Uses mutex to prevent race conditions in concurrent state changes.
     *
     * @param invoiceId - The invoice ID
     * @returns Object with success status and the invoice
     */
    markInvoiceExpired(invoiceId: string): Promise<{
        success: boolean;
        invoice: DogeInvoice | null;
    }>;
    /**
     * List invoices with optional filtering.
     *
     * @param filter - Optional filter criteria
     * @returns Array of matching invoices
     */
    listInvoices(filter?: InvoiceFilter): DogeInvoice[];
    /**
     * Get counts by status.
     */
    getStats(): Record<InvoiceStatus | "total", number>;
    /**
     * Load invoices from disk.
     */
    load(): Promise<void>;
    /**
     * Save invoices to disk.
     */
    save(): Promise<void>;
    /**
     * Evict oldest non-pending invoices when storage cap is reached.
     * Prefers evicting expired, then paid, then cancelled — oldest first.
     */
    private evictOldInvoices;
    /**
     * Check if an invoice is expired based on current time.
     */
    isExpired(invoice: DogeInvoice): boolean;
    /**
     * Expire all pending invoices past their expiry time.
     * Returns the number of invoices expired.
     */
    cleanupExpired(): Promise<number>;
    /**
     * Update the receiving address (for address rotation).
     */
    updateAddress(address: string): void;
    /**
     * Get the number of stored invoices.
     */
    get count(): number;
}
/**
 * Create an invoice manager with the given configuration.
 */
export declare function createInvoiceManager(config: InvoiceManagerConfig): InvoiceManager;
//# sourceMappingURL=invoice.d.ts.map