/**
 * DOGE Wallet — Agent Discovery
 *
 * Generate well-known endpoint payloads for agent payment discovery.
 * Much discover. Very endpoint. Wow. 🐕
 */
import type { WellKnownPayload, ServicePricing } from "./types.js";
export interface DiscoveryConfig {
    /** Agent name */
    name: string;
    /** DOGE receiving address */
    address: string;
    /** Network (mainnet/testnet) */
    network: "mainnet" | "testnet";
    /** Operator name (optional) */
    operator?: string;
    /** List of capabilities (optional) */
    capabilities?: string[];
    /** Invoice endpoint URL (optional) */
    invoiceEndpoint?: string;
    /** Pricing per capability (optional) */
    pricing?: Record<string, ServicePricing>;
}
/**
 * Generate a well-known endpoint payload for agent discovery.
 *
 * This payload is meant to be served at:
 * `/.well-known/openclaw-pay.json`
 *
 * @param config - Discovery configuration
 * @returns WellKnownPayload object
 */
export declare function generateWellKnown(config: DiscoveryConfig): WellKnownPayload;
/**
 * Serialize a well-known payload to JSON string.
 * Includes pretty-printing for human readability.
 *
 * @param payload - The well-known payload
 * @returns Formatted JSON string
 */
export declare function serializeWellKnown(payload: WellKnownPayload): string;
/**
 * Parse a well-known payload from JSON string.
 *
 * @param json - JSON string to parse
 * @returns Parsed WellKnownPayload
 * @throws Error if invalid JSON or missing required fields
 */
export declare function parseWellKnown(json: string): WellKnownPayload;
/**
 * Fetch and parse a well-known endpoint from a URL.
 *
 * @param baseUrl - Base URL of the agent's service
 * @param timeoutMs - Request timeout in milliseconds (default: 10000)
 * @returns Parsed WellKnownPayload or null if not found
 */
export declare function fetchWellKnown(baseUrl: string, timeoutMs?: number): Promise<WellKnownPayload | null>;
/**
 * Check if an agent supports a specific capability.
 *
 * @param payload - The agent's well-known payload
 * @param capability - Capability to check for
 * @returns True if the capability is listed
 */
export declare function hasCapability(payload: WellKnownPayload, capability: string): boolean;
/**
 * Get the pricing for a specific capability.
 *
 * @param payload - The agent's well-known payload
 * @param capability - Capability to get pricing for
 * @returns ServicePricing or null if not defined
 */
export declare function getPricing(payload: WellKnownPayload, capability: string): ServicePricing | null;
//# sourceMappingURL=discovery.d.ts.map