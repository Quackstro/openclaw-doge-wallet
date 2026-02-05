/**
 * DOGE Wallet — Invoice Management
 *
 * Create, track, and manage A2A payment invoices.
 * Much invoice. Very track. Wow. 🐕
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Mutex } from "async-mutex";
import type {
  DogeInvoice,
  InvoiceStatus,
  InvoiceFilter,
  InvoiceStore,
} from "./types.js";
import {
  DEFAULT_EXPIRY_MS,
  MAX_STORED_INVOICES,
} from "./types.js";

// ============================================================================
// Invoice Options
// ============================================================================

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

// ============================================================================
// Invoice Manager
// ============================================================================

export class InvoiceManager {
  private config: InvoiceManagerConfig;
  private filePath: string;
  private invoices: Map<string, DogeInvoice> = new Map();
  private log: (level: "info" | "warn" | "error", msg: string) => void;
  /** Mutex for thread-safe invoice state changes */
  private invoiceMutex = new Mutex();

  constructor(config: InvoiceManagerConfig) {
    this.config = config;
    this.filePath = join(config.dataDir, "invoices.json");
    this.log = config.log ?? (() => {});
  }

  // --------------------------------------------------------------------------
  // Core Operations
  // --------------------------------------------------------------------------

  /**
   * Create a new invoice.
   *
   * @param amount - Amount in DOGE
   * @param description - What this payment is for
   * @param options - Optional settings (expiry, callback, metadata)
   * @returns The created invoice
   */
  createInvoice(
    amount: number,
    description: string,
    options: CreateInvoiceOptions = {},
  ): DogeInvoice {
    if (amount <= 0) {
      throw new Error("Invoice amount must be positive");
    }
    if (!description || description.trim().length === 0) {
      throw new Error("Invoice description is required");
    }

    const now = new Date();
    const expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    const expiresAt = new Date(now.getTime() + expiryMs);

    const invoice: DogeInvoice = {
      version: "1.0",
      invoiceId: randomUUID(),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
      payee: {
        name: this.config.name,
        address: this.config.address,
        operator: this.config.operator,
      },
      payment: {
        amount,
        currency: "DOGE",
        description: description.trim(),
        reference: options.reference,
      },
      metadata: options.metadata,
    };

    // Add callback if provided
    if (options.callbackUrl) {
      invoice.callback = {
        url: options.callbackUrl,
        token: options.callbackToken,
      };
    }

    // Store in memory
    this.invoices.set(invoice.invoiceId, invoice);

    // Persist async (don't block)
    this.save().catch((err) => {
      this.log("error", `doge-wallet: failed to persist invoice: ${err.message ?? err}`);
    });

    this.log("info", `doge-wallet: created invoice ${invoice.invoiceId} for ${amount} DOGE`);
    return invoice;
  }

  /**
   * Get an invoice by ID.
   *
   * @param invoiceId - The invoice ID to look up
   * @returns The invoice or null if not found
   */
  getInvoice(invoiceId: string): DogeInvoice | null {
    return this.invoices.get(invoiceId) ?? null;
  }

  /**
   * Mark an invoice as paid.
   * Uses mutex to prevent race conditions in concurrent state changes.
   *
   * @param invoiceId - The invoice ID
   * @param txid - The transaction ID that paid this invoice
   * @returns Object with success status and the invoice
   */
  async markInvoicePaid(invoiceId: string, txid: string): Promise<{success: boolean; invoice: DogeInvoice | null}> {
    return this.invoiceMutex.runExclusive(async () => {
      const invoice = this.invoices.get(invoiceId);
      if (!invoice) {
        this.log("warn", `doge-wallet: cannot mark unknown invoice ${invoiceId} as paid`);
        return { success: false, invoice: null };
      }

      if (invoice.status !== "pending") {
        this.log("warn", `doge-wallet: invoice ${invoiceId} is already ${invoice.status}`);
        return { success: false, invoice };
      }

      invoice.status = "paid";
      invoice.paidAt = new Date().toISOString();
      invoice.txid = txid;

      await this.save();
      this.log("info", `doge-wallet: invoice ${invoiceId} marked as paid (tx: ${txid})`);
      return { success: true, invoice };
    });
  }

  /**
   * Mark an invoice as cancelled.
   * Uses mutex to prevent race conditions in concurrent state changes.
   *
   * @param invoiceId - The invoice ID
   * @returns Object with success status and the invoice
   */
  async markInvoiceCancelled(invoiceId: string): Promise<{success: boolean; invoice: DogeInvoice | null}> {
    return this.invoiceMutex.runExclusive(async () => {
      const invoice = this.invoices.get(invoiceId);
      if (!invoice) {
        return { success: false, invoice: null };
      }

      if (invoice.status !== "pending") {
        return { success: false, invoice };
      }

      invoice.status = "cancelled";
      await this.save();
      this.log("info", `doge-wallet: invoice ${invoiceId} cancelled`);
      return { success: true, invoice };
    });
  }

  /**
   * Mark an invoice as expired.
   * Uses mutex to prevent race conditions in concurrent state changes.
   *
   * @param invoiceId - The invoice ID
   * @returns Object with success status and the invoice
   */
  async markInvoiceExpired(invoiceId: string): Promise<{success: boolean; invoice: DogeInvoice | null}> {
    return this.invoiceMutex.runExclusive(async () => {
      const invoice = this.invoices.get(invoiceId);
      if (!invoice) {
        return { success: false, invoice: null };
      }

      if (invoice.status !== "pending") {
        return { success: false, invoice };
      }

      invoice.status = "expired";
      await this.save();
      return { success: true, invoice };
    });
  }

  /**
   * List invoices with optional filtering.
   *
   * @param filter - Optional filter criteria
   * @returns Array of matching invoices
   */
  listInvoices(filter?: InvoiceFilter): DogeInvoice[] {
    let results = Array.from(this.invoices.values());

    if (filter) {
      // Filter by status
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        results = results.filter((inv) => statuses.includes(inv.status));
      }

      // Filter by creation time
      if (filter.createdAfter) {
        const after = new Date(filter.createdAfter).getTime();
        results = results.filter((inv) => new Date(inv.createdAt).getTime() >= after);
      }
      if (filter.createdBefore) {
        const before = new Date(filter.createdBefore).getTime();
        results = results.filter((inv) => new Date(inv.createdAt).getTime() <= before);
      }
    }

    // Sort by creation time (newest first)
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply limit
    const limit = filter?.limit ?? 100;
    return results.slice(0, limit);
  }

  /**
   * Get counts by status.
   */
  getStats(): Record<InvoiceStatus | "total", number> {
    const stats = {
      pending: 0,
      paid: 0,
      expired: 0,
      cancelled: 0,
      total: 0,
    };

    for (const invoice of this.invoices.values()) {
      stats[invoice.status]++;
      stats.total++;
    }

    return stats;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * Load invoices from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.filePath, "utf-8");
      const store = JSON.parse(content) as InvoiceStore;

      if (store.version !== 1) {
        this.log("warn", `doge-wallet: unknown invoice store version ${store.version}`);
      }

      this.invoices.clear();
      for (const [id, invoice] of Object.entries(store.invoices)) {
        this.invoices.set(id, invoice);
      }

      this.log("info", `doge-wallet: loaded ${this.invoices.size} invoices`);
    } catch (err: any) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // No file yet — that's fine
        this.log("info", "doge-wallet: no invoice store found, starting fresh");
        return;
      }
      this.log("error", `doge-wallet: failed to load invoices: ${err.message ?? err}`);
    }
  }

  /**
   * Save invoices to disk.
   */
  async save(): Promise<void> {
    const store: InvoiceStore = {
      version: 1,
      invoices: Object.fromEntries(this.invoices),
      lastUpdated: new Date().toISOString(),
    };

    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      await writeFile(this.filePath, JSON.stringify(store, null, 2), { mode: 0o600 });
    } catch (err: any) {
      this.log("error", `doge-wallet: failed to save invoices: ${err.message ?? err}`);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Check if an invoice is expired based on current time.
   */
  isExpired(invoice: DogeInvoice): boolean {
    if (invoice.status !== "pending") {
      return false;
    }
    return new Date(invoice.expiresAt).getTime() < Date.now();
  }

  /**
   * Update the receiving address (for address rotation).
   */
  updateAddress(address: string): void {
    this.config.address = address;
  }

  /**
   * Get the number of stored invoices.
   */
  get count(): number {
    return this.invoices.size;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an invoice manager with the given configuration.
 */
export function createInvoiceManager(config: InvoiceManagerConfig): InvoiceManager {
  return new InvoiceManager(config);
}
