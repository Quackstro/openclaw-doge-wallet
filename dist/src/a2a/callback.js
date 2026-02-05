/**
 * DOGE Wallet — Payment Callback Protocol
 *
 * Send payment notifications to payee callback URLs.
 * Much notify. Very protocol. Wow. 🐕
 */
// ============================================================================
// SSRF Protection
// ============================================================================
/**
 * Validate a callback URL to prevent SSRF attacks.
 * Denies localhost, private IPs, link-local addresses, and non-HTTPS URLs.
 *
 * @param url - The callback URL to validate
 * @returns true if URL is safe to call, false otherwise
 */
function isValidCallbackUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return false;
    }
    // Require HTTPS
    if (parsed.protocol !== "https:") {
        return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    // Deny localhost
    if (hostname === "localhost" || hostname === "localhost.localdomain") {
        return false;
    }
    // Check for IP addresses
    // IPv4 pattern
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        const octets = ipv4Match.slice(1).map(Number);
        const [a, b, c, d] = octets;
        // Validate octets are in range
        if (octets.some((o) => o > 255)) {
            return false;
        }
        // 127.x.x.x (loopback)
        if (a === 127)
            return false;
        // 10.x.x.x (private)
        if (a === 10)
            return false;
        // 172.16.0.0 - 172.31.255.255 (private)
        if (a === 172 && b >= 16 && b <= 31)
            return false;
        // 192.168.x.x (private)
        if (a === 192 && b === 168)
            return false;
        // 169.254.x.x (link-local)
        if (a === 169 && b === 254)
            return false;
        // 0.0.0.0
        if (a === 0 && b === 0 && c === 0 && d === 0)
            return false;
    }
    // IPv6 patterns (simplified - deny obvious private/local ranges)
    if (hostname.startsWith("[")) {
        const ipv6 = hostname.slice(1, -1).toLowerCase();
        // ::1 (loopback)
        if (ipv6 === "::1")
            return false;
        // fe80:: (link-local)
        if (ipv6.startsWith("fe80:"))
            return false;
        // fc00::/fd00:: (unique local)
        if (ipv6.startsWith("fc") || ipv6.startsWith("fd"))
            return false;
    }
    return true;
}
// ============================================================================
// Callback Sender
// ============================================================================
export class CallbackSender {
    timeoutMs;
    retries;
    retryDelayMs;
    log;
    constructor(config = {}) {
        this.timeoutMs = config.timeoutMs ?? 10_000;
        this.retries = config.retries ?? 1;
        this.retryDelayMs = config.retryDelayMs ?? 2_000;
        this.log = config.log ?? (() => { });
    }
    /**
     * Send a payment callback to the invoice's callback URL.
     *
     * @param invoice - The invoice that was paid
     * @param txid - Transaction ID of the payment
     * @param fee - Fee paid in DOGE
     * @param confirmations - Number of confirmations
     * @returns Callback result
     */
    async sendPaymentCallback(invoice, txid, fee, confirmations = 0) {
        // Check if invoice has a callback URL
        if (!invoice.callback?.url) {
            return {
                success: true,
                attempts: 0,
                response: { status: "accepted", message: "No callback URL configured" },
            };
        }
        // SSRF protection: validate callback URL
        if (!isValidCallbackUrl(invoice.callback.url)) {
            this.log("warn", `doge-wallet: blocked callback to invalid/private URL: ${invoice.callback.url}`);
            return {
                success: false,
                attempts: 0,
                error: "Callback URL blocked: must be HTTPS to a public address",
            };
        }
        const payload = {
            invoiceId: invoice.invoiceId,
            txid,
            amount: invoice.payment.amount,
            fee,
            timestamp: new Date().toISOString(),
            status: confirmations > 0 ? "confirmed" : "broadcast",
            confirmations,
        };
        let lastError;
        let lastStatusCode;
        // Try with retries
        for (let attempt = 1; attempt <= this.retries + 1; attempt++) {
            try {
                const result = await this.doSend(invoice.callback.url, payload, invoice.callback.token);
                this.log("info", `doge-wallet: callback sent to ${invoice.callback.url} (attempt ${attempt}, status ${result.statusCode})`);
                if (result.success) {
                    return {
                        success: true,
                        response: result.response,
                        statusCode: result.statusCode,
                        attempts: attempt,
                    };
                }
                lastError = result.error;
                lastStatusCode = result.statusCode;
            }
            catch (err) {
                lastError = err.message ?? String(err);
                this.log("warn", `doge-wallet: callback attempt ${attempt} failed: ${lastError}`);
            }
            // Wait before retry (unless it's the last attempt)
            if (attempt < this.retries + 1) {
                await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
            }
        }
        // All attempts failed
        this.log("error", `doge-wallet: all ${this.retries + 1} callback attempts failed for invoice ${invoice.invoiceId}`);
        return {
            success: false,
            statusCode: lastStatusCode,
            error: lastError ?? "Unknown error",
            attempts: this.retries + 1,
        };
    }
    /**
     * Send a confirmation update callback.
     * Use this when a payment gets more confirmations.
     */
    async sendConfirmationUpdate(invoice, txid, confirmations) {
        // Only send if callback URL exists
        if (!invoice.callback?.url) {
            return {
                success: true,
                attempts: 0,
                response: { status: "accepted", message: "No callback URL configured" },
            };
        }
        // Use same mechanism but with "confirmed" status
        return this.sendPaymentCallback(invoice, txid, 0, confirmations);
    }
    // --------------------------------------------------------------------------
    // Private Helpers
    // --------------------------------------------------------------------------
    /**
     * Actually send the callback HTTP request.
     */
    async doSend(url, payload, token) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const headers = {
                "Content-Type": "application/json",
                "User-Agent": "OpenClaw-DOGE-Wallet/1.0",
            };
            // SECURITY: Token sent via Authorization header over HTTPS only.
            // Receiving servers should not log Authorization headers.
            // Future enhancement: Consider HMAC signature in body instead.
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }
            const response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            // Try to parse response body
            let responseBody;
            try {
                const text = await response.text();
                if (text) {
                    responseBody = JSON.parse(text);
                }
            }
            catch {
                // Ignore parse errors — response body is optional
            }
            if (response.ok) {
                return {
                    success: true,
                    response: responseBody ?? { status: "accepted" },
                    statusCode: response.status,
                };
            }
            return {
                success: false,
                response: responseBody,
                statusCode: response.status,
                error: `HTTP ${response.status}: ${response.statusText}`,
            };
        }
        catch (err) {
            clearTimeout(timeoutId);
            if (err.name === "AbortError") {
                return {
                    success: false,
                    statusCode: 0,
                    error: `Request timed out after ${this.timeoutMs}ms`,
                };
            }
            // SECURITY: Sanitize error - ensure we don't leak auth headers in error messages
            const safeError = (err.message ?? String(err)).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
            return {
                success: false,
                statusCode: 0,
                error: safeError,
            };
        }
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Create a callback sender with the given configuration.
 */
export function createCallbackSender(config = {}) {
    return new CallbackSender(config);
}
//# sourceMappingURL=callback.js.map