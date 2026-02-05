/**
 * DOGE Wallet — Agent-to-Agent Protocol
 *
 * Much A2A. Very micro-transaction. Wow. 🐕
 */
export type { DogeInvoice, InvoiceStatus, PaymentNotification, PaymentCallback, CallbackResponse, VerificationResult, ServicePricing, WellKnownPayload, InvoiceFilter, InvoiceStore, } from "./types.js";
export { OP_RETURN_PREFIX, DEFAULT_EXPIRY_MS, MAX_STORED_INVOICES, MIN_CONFIRMATIONS_TESTNET, MIN_CONFIRMATIONS_MAINNET, } from "./types.js";
export { InvoiceManager, createInvoiceManager, type CreateInvoiceOptions, type InvoiceManagerConfig, } from "./invoice.js";
export { PaymentVerifier, createPaymentVerifier, type PaymentVerifierConfig, } from "./verification.js";
export { CallbackSender, createCallbackSender, type CallbackConfig, type CallbackResult, } from "./callback.js";
export { generateWellKnown, serializeWellKnown, parseWellKnown, fetchWellKnown, hasCapability, getPricing, type DiscoveryConfig, } from "./discovery.js";
export { ExpiryManager, createExpiryManager, cleanupExpiredInvoices, type ExpiryCleanupResult, type ExpiryConfig, } from "./expiry.js";
//# sourceMappingURL=index.d.ts.map