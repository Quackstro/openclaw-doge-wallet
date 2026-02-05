/**
 * DOGE Wallet — Payment Callback Protocol
 *
 * Send payment notifications to payee callback URLs.
 * Much notify. Very protocol. Wow. 🐕
 */
import type { DogeInvoice, CallbackResponse } from "./types.js";
export interface CallbackConfig {
    /** Request timeout in milliseconds (default: 10000) */
    timeoutMs?: number;
    /** Number of retry attempts on failure (default: 1) */
    retries?: number;
    /** Delay between retries in milliseconds (default: 2000) */
    retryDelayMs?: number;
    /** Logger function */
    log?: (level: "info" | "warn" | "error", msg: string) => void;
}
export interface CallbackResult {
    /** Whether the callback was successfully delivered */
    success: boolean;
    /** Response from the payee (if successful) */
    response?: CallbackResponse;
    /** HTTP status code (if any) */
    statusCode?: number;
    /** Error message (if failed) */
    error?: string;
    /** Number of attempts made */
    attempts: number;
}
export declare class CallbackSender {
    private timeoutMs;
    private retries;
    private retryDelayMs;
    private log;
    constructor(config?: CallbackConfig);
    /**
     * Send a payment callback to the invoice's callback URL.
     *
     * @param invoice - The invoice that was paid
     * @param txid - Transaction ID of the payment
     * @param fee - Fee paid in DOGE
     * @param confirmations - Number of confirmations
     * @returns Callback result
     */
    sendPaymentCallback(invoice: DogeInvoice, txid: string, fee: number, confirmations?: number): Promise<CallbackResult>;
    /**
     * Send a confirmation update callback.
     * Use this when a payment gets more confirmations.
     */
    sendConfirmationUpdate(invoice: DogeInvoice, txid: string, confirmations: number): Promise<CallbackResult>;
    /**
     * Actually send the callback HTTP request.
     */
    private doSend;
}
/**
 * Create a callback sender with the given configuration.
 */
export declare function createCallbackSender(config?: CallbackConfig): CallbackSender;
//# sourceMappingURL=callback.d.ts.map