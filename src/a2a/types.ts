/**
 * DOGE Wallet — Agent-to-Agent Protocol Types
 *
 * Type definitions for the A2A micro-transaction protocol.
 * Much invoice. Very protocol. Wow. 🐕
 */

// ============================================================================
// Invoice Types
// ============================================================================

/** Invoice status lifecycle */
export type InvoiceStatus = "pending" | "paid" | "expired" | "cancelled";

/**
 * A DOGE invoice for agent-to-agent payments.
 * Follows the spec from Section 9.2 of the design doc.
 */
export interface DogeInvoice {
  /** Protocol version — always "1.0" */
  version: "1.0";

  /** Unique invoice ID (UUID) */
  invoiceId: string;

  /** When the invoice was created (ISO 8601) */
  createdAt: string;

  /** When the invoice expires (ISO 8601) */
  expiresAt: string;

  /** Current status of the invoice */
  status: InvoiceStatus;

  /** Payee (who's asking for money) */
  payee: {
    /** Agent or service name */
    name: string;
    /** DOGE address to pay */
    address: string;
    /** Human/org operating the agent (optional) */
    operator?: string;
  };

  /** Payment details */
  payment: {
    /** Amount in DOGE */
    amount: number;
    /** Currency — always "DOGE" */
    currency: "DOGE";
    /** What this payment is for */
    description: string;
    /** External reference ID (optional) */
    reference?: string;
  };

  /** Callback for payment notification (optional) */
  callback?: {
    /** POST to this URL when paid */
    url: string;
    /** Auth token for callback (optional) */
    token?: string;
  };

  /** Arbitrary metadata for extensibility */
  metadata?: Record<string, unknown>;

  /** When the invoice was paid (ISO 8601, set when status becomes "paid") */
  paidAt?: string;

  /** Transaction ID that paid this invoice */
  txid?: string;
}

// ============================================================================
// Payment Notification Types
// ============================================================================

/**
 * Notification sent when a payment is made.
 * The payer sends this to the payee's callback URL.
 */
export interface PaymentNotification {
  /** Invoice ID being paid */
  invoiceId: string;
  /** On-chain transaction ID */
  txid: string;
  /** Amount actually sent (DOGE) */
  amount: number;
  /** When the payment was broadcast (ISO 8601) */
  paidAt: string;
}

/**
 * Full payment callback payload sent to callback URL.
 */
export interface PaymentCallback {
  /** Invoice ID */
  invoiceId: string;
  /** Transaction ID */
  txid: string;
  /** Amount in DOGE */
  amount: number;
  /** Fee paid in DOGE */
  fee: number;
  /** When the callback was sent (ISO 8601) */
  timestamp: string;
  /** Current status of the payment */
  status: "broadcast" | "confirmed";
  /** Number of confirmations */
  confirmations: number;
}

/**
 * Response from the payee's callback URL.
 */
export interface CallbackResponse {
  /** Whether the payment was accepted */
  status: "accepted" | "rejected";
  /** Optional message */
  message?: string;
}

// ============================================================================
// Verification Types
// ============================================================================

/**
 * Result of payment verification.
 */
export interface VerificationResult {
  /** Whether the payment is valid and sufficient */
  valid: boolean;
  /** Number of confirmations at verification time */
  confirmations: number;
  /** Amount received in koinu */
  amountReceived: number;
  /** Amount expected in koinu */
  amountExpected: number;
  /** Whether OP_RETURN matches invoice ID */
  opReturnMatch: boolean;
  /** Human-readable reason if invalid */
  reason?: string;
}

// ============================================================================
// Discovery Types
// ============================================================================

/**
 * Pricing entry for a service.
 */
export interface ServicePricing {
  /** Amount in DOGE */
  amount: number;
  /** Currency — always "DOGE" */
  currency: "DOGE";
  /** Pricing unit (e.g., "per-image", "per-query", "per-hour") */
  unit: string;
}

/**
 * Well-known endpoint payload for agent discovery.
 * Published at `/.well-known/openclaw-pay.json`
 */
export interface WellKnownPayload {
  /** Protocol version */
  version: "1.0";

  /** Agent information */
  agent: {
    /** Agent name */
    name: string;
    /** Human/org operating the agent */
    operator?: string;
    /** List of capabilities (e.g., ["image-gen", "code-review"]) */
    capabilities?: string[];
  };

  /** Payment configuration */
  payment: {
    dogecoin: {
      /** DOGE address for receiving payments */
      address: string;
      /** Network (mainnet/testnet) */
      network: "mainnet" | "testnet";
      /** Optional: endpoint for creating invoices */
      invoiceEndpoint?: string;
    };
  };

  /** Optional pricing for each capability */
  pricing?: Record<string, ServicePricing>;
}

// ============================================================================
// Invoice Store Types
// ============================================================================

/**
 * Filter options for listing invoices.
 */
export interface InvoiceFilter {
  /** Filter by status */
  status?: InvoiceStatus | InvoiceStatus[];
  /** Filter by creation time (ISO 8601, after this date) */
  createdAfter?: string;
  /** Filter by creation time (ISO 8601, before this date) */
  createdBefore?: string;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Persisted invoice store format.
 */
export interface InvoiceStore {
  /** Store format version */
  version: 1;
  /** All invoices, keyed by invoiceId */
  invoices: Record<string, DogeInvoice>;
  /** Last updated timestamp (ISO 8601) */
  lastUpdated: string;
}

// ============================================================================
// Constants
// ============================================================================

/** OP_RETURN prefix for OpenClaw invoice IDs */
export const OP_RETURN_PREFIX = "OC:";

/** Default invoice expiry duration (1 hour) */
export const DEFAULT_EXPIRY_MS = 60 * 60 * 1000;

/** Maximum invoices to keep in storage */
export const MAX_STORED_INVOICES = 100;

/** Minimum confirmations for testnet */
export const MIN_CONFIRMATIONS_TESTNET = 1;

/** Minimum confirmations for mainnet */
export const MIN_CONFIRMATIONS_MAINNET = 6;
