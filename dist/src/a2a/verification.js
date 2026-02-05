/**
 * DOGE Wallet — Payment Verification
 *
 * Verify on-chain payments for A2A invoices.
 * Much verify. Very confirm. Wow. 🐕
 */
import { OP_RETURN_PREFIX, MIN_CONFIRMATIONS_MAINNET, MIN_CONFIRMATIONS_TESTNET, } from "./types.js";
import { dogeToKoinu } from "../types.js";
// ============================================================================
// Constants
// ============================================================================
/** Dust threshold in koinu — payments within this of expected are ok */
const DUST_TOLERANCE_KOINU = 100_000; // 0.001 DOGE
// ============================================================================
// Payment Verifier
// ============================================================================
export class PaymentVerifier {
    provider;
    ourAddress;
    network;
    log;
    minConfirmations;
    constructor(config) {
        this.provider = config.provider;
        this.ourAddress = config.ourAddress;
        this.network = config.network;
        this.log = config.log ?? (() => { });
        this.minConfirmations =
            config.network === "testnet"
                ? MIN_CONFIRMATIONS_TESTNET
                : MIN_CONFIRMATIONS_MAINNET;
    }
    /**
     * Verify a payment notification against an invoice.
     *
     * @param notification - The payment notification from the payer
     * @param invoice - The invoice being paid
     * @returns Verification result with details
     */
    async verifyPayment(notification, invoice) {
        const { txid, invoiceId } = notification;
        // Sanity check: invoice ID must match
        if (invoiceId !== invoice.invoiceId) {
            return {
                valid: false,
                confirmations: 0,
                amountReceived: 0,
                amountExpected: dogeToKoinu(invoice.payment.amount),
                opReturnMatch: false,
                reason: `Invoice ID mismatch: expected ${invoice.invoiceId}, got ${invoiceId}`,
            };
        }
        // 1. Fetch transaction from blockchain
        let tx;
        try {
            tx = await this.provider.getTransaction(txid);
        }
        catch (err) {
            this.log("warn", `doge-wallet: failed to fetch tx ${txid}: ${err.message ?? err}`);
            return {
                valid: false,
                confirmations: 0,
                amountReceived: 0,
                amountExpected: dogeToKoinu(invoice.payment.amount),
                opReturnMatch: false,
                reason: `Could not fetch transaction: ${err.message ?? "unknown error"}`,
            };
        }
        // 2. Check that at least one output pays our address
        const ourOutput = tx.outputs.find((o) => o.address === this.ourAddress);
        if (!ourOutput) {
            return {
                valid: false,
                confirmations: tx.confirmations,
                amountReceived: 0,
                amountExpected: dogeToKoinu(invoice.payment.amount),
                opReturnMatch: false,
                reason: `No output to our address ${this.ourAddress}`,
            };
        }
        const amountReceived = ourOutput.amount;
        const amountExpected = dogeToKoinu(invoice.payment.amount);
        // 3. Check amount matches invoice (within dust tolerance)
        const difference = Math.abs(amountReceived - amountExpected);
        if (difference > DUST_TOLERANCE_KOINU) {
            const receivedDoge = amountReceived / 1e8;
            const expectedDoge = amountExpected / 1e8;
            return {
                valid: false,
                confirmations: tx.confirmations,
                amountReceived,
                amountExpected,
                opReturnMatch: false,
                reason: `Amount mismatch: received ${receivedDoge} DOGE, expected ${expectedDoge} DOGE`,
            };
        }
        // 4. Check OP_RETURN (optional but logged)
        const opReturnMatch = this.checkOpReturn(tx, invoice.invoiceId);
        if (!opReturnMatch) {
            this.log("warn", `doge-wallet: OP_RETURN mismatch or missing for invoice ${invoice.invoiceId}`);
            // Warning but not failure — OP_RETURN is optional
        }
        // 5. Check confirmations
        if (tx.confirmations < this.minConfirmations) {
            return {
                valid: false,
                confirmations: tx.confirmations,
                amountReceived,
                amountExpected,
                opReturnMatch,
                reason: `Insufficient confirmations: ${tx.confirmations}/${this.minConfirmations}`,
            };
        }
        // All checks passed!
        this.log("info", `doge-wallet: payment verified for invoice ${invoice.invoiceId} (tx: ${txid}, ${tx.confirmations} confirmations)`);
        return {
            valid: true,
            confirmations: tx.confirmations,
            amountReceived,
            amountExpected,
            opReturnMatch,
        };
    }
    /**
     * Quick check if a transaction exists and has minimum confirmations.
     * Use this for polling confirmation status.
     *
     * @param txid - Transaction ID to check
     * @returns Number of confirmations, or -1 if tx not found
     */
    async getConfirmations(txid) {
        try {
            const tx = await this.provider.getTransaction(txid);
            return tx.confirmations;
        }
        catch {
            return -1;
        }
    }
    /**
     * Wait for a transaction to reach minimum confirmations.
     *
     * @param txid - Transaction ID to wait for
     * @param timeoutMs - Maximum time to wait (default: 30 minutes)
     * @param pollIntervalMs - How often to check (default: 30 seconds)
     * @returns Final confirmation count, or -1 if timeout/error
     */
    async waitForConfirmations(txid, timeoutMs = 30 * 60 * 1000, pollIntervalMs = 30 * 1000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const confirmations = await this.getConfirmations(txid);
            if (confirmations < 0) {
                // Transaction not found — might be too early or invalid
                this.log("warn", `doge-wallet: tx ${txid} not found on-chain yet`);
            }
            else if (confirmations >= this.minConfirmations) {
                return confirmations;
            }
            // Wait before next poll
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        this.log("warn", `doge-wallet: timeout waiting for tx ${txid} confirmations`);
        return -1;
    }
    /**
     * Update the receiving address (for address rotation).
     */
    updateAddress(address) {
        this.ourAddress = address;
    }
    // --------------------------------------------------------------------------
    // Private Helpers
    // --------------------------------------------------------------------------
    /**
     * Check if the transaction's OP_RETURN matches the expected invoice ID.
     */
    checkOpReturn(tx, invoiceId) {
        // Find OP_RETURN output
        const opReturnOutput = tx.outputs.find((o) => o.scriptType === "OP_RETURN" || o.script?.startsWith("6a"));
        if (!opReturnOutput) {
            return false;
        }
        // Try to decode the OP_RETURN data
        // Format should be: OP_RETURN <length> <data>
        // Hex: 6a <len> <data>
        try {
            const script = opReturnOutput.script;
            if (!script)
                return false;
            // Skip the OP_RETURN opcode (6a) and length byte
            // The data starts after "6a" + 2 hex chars for length
            const dataHex = script.slice(4);
            const data = Buffer.from(dataHex, "hex").toString("utf-8");
            // Expected format: "OC:<invoiceId>"
            const expected = `${OP_RETURN_PREFIX}${invoiceId}`;
            return data === expected;
        }
        catch {
            return false;
        }
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create a payment verifier with the given configuration.
 */
export function createPaymentVerifier(config) {
    return new PaymentVerifier(config);
}
//# sourceMappingURL=verification.js.map