/**
 * DOGE Wallet — Payment Verification
 *
 * Verify on-chain payments for A2A invoices.
 * Much verify. Very confirm. Wow. 🐕
 */
import type { DogeApiProvider } from "../types.js";
import type { DogeInvoice, PaymentNotification, VerificationResult } from "./types.js";
export interface PaymentVerifierConfig {
    /** API provider for blockchain queries */
    provider: DogeApiProvider;
    /** Our receiving address */
    ourAddress: string;
    /** Network (mainnet/testnet) */
    network: "mainnet" | "testnet";
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
export declare class PaymentVerifier {
    private provider;
    private ourAddress;
    private network;
    private log;
    private minConfirmations;
    constructor(config: PaymentVerifierConfig);
    /**
     * Verify a payment notification against an invoice.
     *
     * @param notification - The payment notification from the payer
     * @param invoice - The invoice being paid
     * @returns Verification result with details
     */
    verifyPayment(notification: PaymentNotification, invoice: DogeInvoice): Promise<VerificationResult>;
    /**
     * Quick check if a transaction exists and has minimum confirmations.
     * Use this for polling confirmation status.
     *
     * @param txid - Transaction ID to check
     * @returns Number of confirmations, or -1 if tx not found
     */
    getConfirmations(txid: string): Promise<number>;
    /**
     * Wait for a transaction to reach minimum confirmations.
     *
     * @param txid - Transaction ID to wait for
     * @param timeoutMs - Maximum time to wait (default: 30 minutes)
     * @param pollIntervalMs - How often to check (default: 30 seconds)
     * @returns Final confirmation count, or -1 if timeout/error
     */
    waitForConfirmations(txid: string, timeoutMs?: number, pollIntervalMs?: number): Promise<number>;
    /**
     * Update the receiving address (for address rotation).
     */
    updateAddress(address: string): void;
    /**
     * Check if the transaction's OP_RETURN matches the expected invoice ID.
     */
    private checkOpReturn;
}
/**
 * Create a payment verifier with the given configuration.
 */
export declare function createPaymentVerifier(config: PaymentVerifierConfig): PaymentVerifier;
//# sourceMappingURL=verification.d.ts.map