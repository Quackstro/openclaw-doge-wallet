/**
 * DOGE Wallet — Agent Discovery
 *
 * Generate well-known endpoint payloads for agent payment discovery.
 * Much discover. Very endpoint. Wow. 🐕
 */
// ============================================================================
// Discovery Generator
// ============================================================================
/**
 * Generate a well-known endpoint payload for agent discovery.
 *
 * This payload is meant to be served at:
 * `/.well-known/openclaw-pay.json`
 *
 * @param config - Discovery configuration
 * @returns WellKnownPayload object
 */
export function generateWellKnown(config) {
    if (!config.name || config.name.trim().length === 0) {
        throw new Error("Agent name is required for discovery");
    }
    if (!config.address || config.address.trim().length === 0) {
        throw new Error("DOGE address is required for discovery");
    }
    const payload = {
        version: "1.0",
        agent: {
            name: config.name.trim(),
            operator: config.operator?.trim(),
            capabilities: config.capabilities,
        },
        payment: {
            dogecoin: {
                address: config.address.trim(),
                network: config.network,
                invoiceEndpoint: config.invoiceEndpoint?.trim(),
            },
        },
    };
    // Add pricing if provided
    if (config.pricing && Object.keys(config.pricing).length > 0) {
        payload.pricing = config.pricing;
    }
    return payload;
}
/**
 * Serialize a well-known payload to JSON string.
 * Includes pretty-printing for human readability.
 *
 * @param payload - The well-known payload
 * @returns Formatted JSON string
 */
export function serializeWellKnown(payload) {
    return JSON.stringify(payload, null, 2);
}
/**
 * Parse a well-known payload from JSON string.
 *
 * @param json - JSON string to parse
 * @returns Parsed WellKnownPayload
 * @throws Error if invalid JSON or missing required fields
 */
export function parseWellKnown(json) {
    const parsed = JSON.parse(json);
    // Validate required fields
    if (parsed.version !== "1.0") {
        throw new Error(`Unsupported well-known version: ${parsed.version}`);
    }
    if (!parsed.agent?.name) {
        throw new Error("Missing required field: agent.name");
    }
    if (!parsed.payment?.dogecoin?.address) {
        throw new Error("Missing required field: payment.dogecoin.address");
    }
    return parsed;
}
/**
 * Fetch and parse a well-known endpoint from a URL.
 *
 * @param baseUrl - Base URL of the agent's service
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 * @returns Parsed WellKnownPayload or null if not found
 */
export async function fetchWellKnown(baseUrl, timeoutMs = 10_000) {
    // Normalize base URL
    const normalized = baseUrl.replace(/\/$/, "");
    const url = `${normalized}/.well-known/openclaw-pay.json`;
    // SSRF protection: only fetch from HTTPS URLs
    if (!url.startsWith("https://")) {
        throw new Error("Discovery URLs must use HTTPS");
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "User-Agent": "OpenClaw-DOGE-Wallet/1.0",
            },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            if (response.status === 404) {
                // Not found is expected for agents that don't publish discovery
                return null;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const json = await response.text();
        return parseWellKnown(json);
    }
    catch (err) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
    }
}
// ============================================================================
// Capability Helpers
// ============================================================================
/**
 * Check if an agent supports a specific capability.
 *
 * @param payload - The agent's well-known payload
 * @param capability - Capability to check for
 * @returns True if the capability is listed
 */
export function hasCapability(payload, capability) {
    return payload.agent.capabilities?.includes(capability) ?? false;
}
/**
 * Get the pricing for a specific capability.
 *
 * @param payload - The agent's well-known payload
 * @param capability - Capability to get pricing for
 * @returns ServicePricing or null if not defined
 */
export function getPricing(payload, capability) {
    return payload.pricing?.[capability] ?? null;
}
//# sourceMappingURL=discovery.js.map