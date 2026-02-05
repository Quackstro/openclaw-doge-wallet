/**
 * DOGE Wallet — Agent-to-Agent Protocol
 *
 * Much A2A. Very micro-transaction. Wow. 🐕
 */
export { OP_RETURN_PREFIX, DEFAULT_EXPIRY_MS, MAX_STORED_INVOICES, MIN_CONFIRMATIONS_TESTNET, MIN_CONFIRMATIONS_MAINNET, } from "./types.js";
// Invoice Management
export { InvoiceManager, createInvoiceManager, } from "./invoice.js";
// Payment Verification
export { PaymentVerifier, createPaymentVerifier, } from "./verification.js";
// Callback Protocol
export { CallbackSender, createCallbackSender, } from "./callback.js";
// Discovery
export { generateWellKnown, serializeWellKnown, parseWellKnown, fetchWellKnown, hasCapability, getPricing, } from "./discovery.js";
// Expiry & Cleanup
export { ExpiryManager, createExpiryManager, cleanupExpiredInvoices, } from "./expiry.js";
//# sourceMappingURL=index.js.map