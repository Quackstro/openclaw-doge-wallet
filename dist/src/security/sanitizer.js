/**
 * DOGE Wallet — Input Sanitization
 *
 * Sanitizes and validates all user-provided input to prevent injection attacks,
 * XSS, and other security issues.
 *
 * Much clean. Very safe. Wow. 🐕
 */
// ============================================================================
// Constants
// ============================================================================
/** Maximum length for description/reason fields */
export const MAX_DESCRIPTION_LENGTH = 500;
/** Maximum length for generic text fields */
export const MAX_TEXT_LENGTH = 1000;
/** Maximum length for reference fields */
export const MAX_REFERENCE_LENGTH = 100;
/** Minimum DOGE amount (dust threshold in DOGE) */
export const MIN_AMOUNT_DOGE = 0.001;
/** Maximum DOGE amount (safety limit — adjustable for mainnet) */
export const MAX_AMOUNT_DOGE = 100_000_000; // 100M DOGE
/** Mainnet daily limit warning threshold */
export const MAINNET_DAILY_LIMIT_WARNING = 1000;
/** Characters allowed in descriptions (basic ASCII + common punctuation) */
const SAFE_TEXT_PATTERN = /^[\w\s.,!?@#$%&*()_+\-=[\]{}|;':"<>/\\`~\n\r]*$/;
/** URL validation pattern */
const URL_PATTERN = /^https?:\/\/[^\s<>"{}|\\^`[\]]+$/;
/** DOGE address patterns */
const MAINNET_ADDRESS_PATTERN = /^D[1-9A-HJ-NP-Za-km-z]{25,34}$/;
const TESTNET_ADDRESS_PATTERN = /^n[1-9A-HJ-NP-Za-km-z]{25,34}$/;
/** Characters to strip from text (control chars except newline/tab) */
const STRIP_CHARS_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
/** Script injection patterns */
const SCRIPT_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi, // onclick=, onerror=, etc.
    /eval\s*\(/gi,
    /expression\s*\(/gi,
];
/** SQL injection patterns (basic detection) */
const SQL_INJECTION_PATTERNS = [
    /;\s*drop\s+/gi,
    /;\s*delete\s+/gi,
    /;\s*update\s+/gi,
    /;\s*insert\s+/gi,
    /union\s+select/gi,
    /'\s*or\s+'1'\s*=\s*'1/gi,
    /"\s*or\s+"1"\s*=\s*"1/gi,
];
/** SSRF dangerous hosts */
const SSRF_BLOCKED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "169.254.", // Link-local
    "10.", // Private class A
    "172.16.", // Private class B start
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
    "192.168.", // Private class C
    "metadata.google.internal",
    "metadata.aws.internal",
    "169.254.169.254", // AWS/GCP metadata
];
// ============================================================================
// Text Sanitization
// ============================================================================
/**
 * Sanitize a description or reason field.
 *
 * @param input - Raw user input
 * @param maxLength - Maximum allowed length (default: MAX_DESCRIPTION_LENGTH)
 */
export function sanitizeDescription(input, maxLength = MAX_DESCRIPTION_LENGTH) {
    // Type check
    if (typeof input !== "string") {
        return { valid: false, error: "Description must be a string" };
    }
    // Trim and normalize whitespace
    let text = input.trim().replace(/\s+/g, " ");
    // Remove control characters
    text = text.replace(STRIP_CHARS_PATTERN, "");
    // Check length
    if (text.length === 0) {
        return { valid: false, error: "Description cannot be empty" };
    }
    if (text.length > maxLength) {
        return {
            valid: false,
            error: `Description too long (max ${maxLength} characters)`,
        };
    }
    // Check for script injection
    for (const pattern of SCRIPT_PATTERNS) {
        if (pattern.test(text)) {
            return { valid: false, error: "Description contains potentially dangerous content" };
        }
    }
    // Check for SQL injection
    for (const pattern of SQL_INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            return { valid: false, error: "Description contains potentially dangerous content" };
        }
    }
    // HTML-encode potentially dangerous characters
    text = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
    return { valid: true, value: text };
}
/**
 * Sanitize a reference/ID field (stricter than description).
 */
export function sanitizeReference(input, maxLength = MAX_REFERENCE_LENGTH) {
    if (typeof input !== "string") {
        return { valid: false, error: "Reference must be a string" };
    }
    // Only allow alphanumeric, dash, underscore
    const text = input.trim();
    if (text.length === 0) {
        return { valid: false, error: "Reference cannot be empty" };
    }
    if (text.length > maxLength) {
        return {
            valid: false,
            error: `Reference too long (max ${maxLength} characters)`,
        };
    }
    if (!/^[\w\-]+$/.test(text)) {
        return {
            valid: false,
            error: "Reference can only contain letters, numbers, dashes, and underscores",
        };
    }
    return { valid: true, value: text };
}
/**
 * Validate a DOGE amount.
 */
export function validateAmount(input, options = {}) {
    const { minAmount = MIN_AMOUNT_DOGE, maxAmount = MAX_AMOUNT_DOGE, network, warnThreshold, } = options;
    // Type check
    let amount;
    if (typeof input === "number") {
        amount = input;
    }
    else if (typeof input === "string") {
        amount = parseFloat(input);
    }
    else {
        return { valid: false, error: "Amount must be a number" };
    }
    // Round to 8 decimal places FIRST to avoid floating point edge cases
    amount = Math.round(amount * 1e8) / 1e8;
    // Now validate
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
        return { valid: false, error: "Amount must be a valid number" };
    }
    if (amount <= 0) {
        return { valid: false, error: "Amount must be positive" };
    }
    const minAmountThreshold = minAmount ?? 0.001; // dust threshold
    if (amount < minAmountThreshold) {
        return { valid: false, error: `Amount below minimum (${minAmountThreshold} DOGE)` };
    }
    // Check maximum
    if (amount > maxAmount) {
        return {
            valid: false,
            error: `Amount exceeds maximum allowed (${maxAmount} DOGE)`,
        };
    }
    // Precision check (DOGE has 8 decimal places) - done after rounding
    const decimalPlaces = (amount.toString().split(".")[1] || "").length;
    if (decimalPlaces > 8) {
        return {
            valid: false,
            error: "Amount precision exceeds 8 decimal places",
        };
    }
    // Warning for large mainnet amounts
    let warning;
    const threshold = warnThreshold ?? (network === "mainnet" ? MAINNET_DAILY_LIMIT_WARNING : undefined);
    if (threshold && amount > threshold) {
        warning = `Large amount: ${amount} DOGE exceeds ${threshold} DOGE threshold. Double-check before sending.`;
    }
    return { valid: true, value: amount, warning };
}
// ============================================================================
// Address Validation
// ============================================================================
/**
 * Validate a DOGE address.
 */
export function validateAddress(input, network = "mainnet") {
    if (typeof input !== "string") {
        return { valid: false, error: "Address must be a string" };
    }
    const address = input.trim();
    if (!address) {
        return { valid: false, error: "Address cannot be empty" };
    }
    const pattern = network === "mainnet" ? MAINNET_ADDRESS_PATTERN : TESTNET_ADDRESS_PATTERN;
    if (!pattern.test(address)) {
        const expected = network === "mainnet" ? "D" : "n";
        return {
            valid: false,
            error: `Invalid ${network} address format. Expected ${expected}... address.`,
        };
    }
    return { valid: true, value: address };
}
// ============================================================================
// URL Validation (with SSRF protection)
// ============================================================================
/**
 * Validate a callback URL (with SSRF protection).
 */
export function validateCallbackUrl(input) {
    if (typeof input !== "string") {
        return { valid: false, error: "URL must be a string" };
    }
    const url = input.trim();
    if (!url) {
        return { valid: false, error: "URL cannot be empty" };
    }
    // Basic URL format check
    if (!URL_PATTERN.test(url)) {
        return { valid: false, error: "Invalid URL format (must be http:// or https://)" };
    }
    // Parse URL for SSRF checks
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return { valid: false, error: "Invalid URL format" };
    }
    // Must be HTTPS for callbacks (security requirement)
    if (parsed.protocol !== "https:") {
        return { valid: false, error: "Callback URL must use HTTPS" };
    }
    // Check for SSRF-dangerous hosts
    const hostname = parsed.hostname.toLowerCase();
    for (const blocked of SSRF_BLOCKED_HOSTS) {
        if (hostname === blocked || hostname.startsWith(blocked) || hostname.endsWith(`.${blocked}`)) {
            return {
                valid: false,
                error: "Callback URL points to blocked/internal host (SSRF protection)",
            };
        }
    }
    // Normalize and check IPv6 patterns
    if (hostname.startsWith("[")) {
        const ipv6 = hostname.slice(1, -1).toLowerCase();
        // Expanded IPv6 blocklist
        const blockedIPv6 = [
            '::1',
            '0:0:0:0:0:0:0:1',
            '::ffff:127.0.0.1',
            '::ffff:10.',
            '::ffff:192.168.',
            '::ffff:172.16.',
            '::ffff:172.17.',
            '::ffff:172.18.',
            '::ffff:172.19.',
            '::ffff:172.20.',
            '::ffff:172.21.',
            '::ffff:172.22.',
            '::ffff:172.23.',
            '::ffff:172.24.',
            '::ffff:172.25.',
            '::ffff:172.26.',
            '::ffff:172.27.',
            '::ffff:172.28.',
            '::ffff:172.29.',
            '::ffff:172.30.',
            '::ffff:172.31.',
        ];
        for (const blocked of blockedIPv6) {
            if (ipv6 === blocked || ipv6.startsWith(blocked)) {
                return {
                    valid: false,
                    error: "Callback URL points to blocked/internal host (SSRF protection)",
                };
            }
        }
    }
    // Check for IP address in hostname (potentially dangerous)
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
        return {
            valid: false,
            error: "Callback URL must use a domain name, not IP address",
        };
    }
    // Check for suspicious ports
    const port = parseInt(parsed.port || "443", 10);
    const safePorts = [80, 443, 8080, 8443];
    if (parsed.port && !safePorts.includes(port)) {
        return {
            valid: false,
            error: `Callback URL uses unusual port ${port}`,
        };
    }
    return { valid: true, value: url };
}
/**
 * Validate confirmation count.
 */
export function validateConfirmations(input, options = {}) {
    const network = options.network ?? "mainnet";
    const defaultMin = network === "mainnet" ? 6 : 1;
    const minConf = options.minConfirmations ?? defaultMin;
    const maxConf = options.maxConfirmations ?? 100;
    let confirmations;
    if (typeof input === "number") {
        confirmations = input;
    }
    else if (typeof input === "string") {
        confirmations = parseInt(input, 10);
    }
    else {
        return { valid: false, error: "Confirmations must be a number" };
    }
    if (isNaN(confirmations) || !Number.isInteger(confirmations)) {
        return { valid: false, error: "Confirmations must be an integer" };
    }
    if (confirmations < 0) {
        return { valid: false, error: "Confirmations cannot be negative" };
    }
    if (confirmations < minConf) {
        return {
            valid: false,
            error: `Minimum ${minConf} confirmations required for ${network}`,
        };
    }
    if (confirmations > maxConf) {
        return {
            valid: false,
            error: `Confirmation count seems unreasonable (max ${maxConf})`,
        };
    }
    return { valid: true, value: confirmations };
}
// ============================================================================
// Error Message Sanitization (prevent info leakage)
// ============================================================================
/**
 * Sanitize error messages to prevent information leakage.
 * Removes sensitive details like file paths, internal errors, etc.
 */
export function sanitizeErrorMessage(error) {
    // Get the error message
    let message;
    if (error instanceof Error) {
        message = error.message;
    }
    else if (typeof error === "string") {
        message = error;
    }
    else {
        return "An unexpected error occurred";
    }
    // Strip file paths
    message = message.replace(/\/[\w\-./]+\.(ts|js|json)/gi, "[file]");
    message = message.replace(/[A-Z]:\\[\w\-./\\]+/gi, "[file]");
    // Strip stack traces
    message = message.replace(/at\s+[\w.<>]+\s+\([^)]+\)/gi, "");
    message = message.replace(/\n\s+at\s+.+/g, "");
    // Strip internal error codes
    message = message.replace(/ENOENT|EACCES|EPERM|ECONNREFUSED|ETIMEDOUT/gi, "system error");
    // Strip potential secrets (API keys, tokens) — look for hex/base64-like patterns
    // that are 32+ chars (avoids redacting normal English words like "InsufficientFundsError")
    message = message.replace(/[0-9a-f]{32,}/gi, "[redacted]");
    message = message.replace(/[A-Za-z0-9+/=]{40,}/g, "[redacted]");
    // Trim whitespace
    message = message.trim();
    // Ensure message isn't empty
    if (!message) {
        return "An unexpected error occurred";
    }
    // Truncate very long messages
    if (message.length > 200) {
        message = message.substring(0, 197) + "...";
    }
    return message;
}
// ============================================================================
// Metadata Sanitization
// ============================================================================
/**
 * Sanitize metadata object (removes functions, limits depth).
 */
export function sanitizeMetadata(input, maxDepth = 3) {
    if (input === null || input === undefined) {
        return { valid: true, value: {} };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        return { valid: false, error: "Metadata must be a plain object" };
    }
    try {
        const sanitized = sanitizeObject(input, 0, maxDepth);
        return { valid: true, value: sanitized };
    }
    catch (err) {
        return { valid: false, error: "Failed to sanitize metadata" };
    }
}
function sanitizeObject(obj, depth, maxDepth) {
    if (depth >= maxDepth) {
        return { _truncated: true };
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        // Skip functions and symbols
        if (typeof value === "function" || typeof value === "symbol") {
            continue;
        }
        // Sanitize key
        const sanitizedKey = key.replace(/[^\w\-_.]/g, "_").substring(0, 50);
        // Sanitize value
        if (value === null || value === undefined) {
            result[sanitizedKey] = null;
        }
        else if (typeof value === "object") {
            if (Array.isArray(value)) {
                result[sanitizedKey] = value.slice(0, 100).map((item) => typeof item === "object" && item !== null
                    ? sanitizeObject(item, depth + 1, maxDepth)
                    : item);
            }
            else {
                result[sanitizedKey] = sanitizeObject(value, depth + 1, maxDepth);
            }
        }
        else if (typeof value === "string") {
            // Truncate long strings
            result[sanitizedKey] = value.substring(0, 1000);
        }
        else {
            result[sanitizedKey] = value;
        }
    }
    return result;
}
//# sourceMappingURL=sanitizer.js.map