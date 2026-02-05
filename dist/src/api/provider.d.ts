/**
 * DOGE Wallet — Abstract API Provider Interface
 *
 * All blockchain API providers implement this interface.
 * Switching providers = new class, same interface. Such modularity. 🐕
 */
import type { DogeApiProvider } from "../types.js";
/**
 * Re-export the DogeApiProvider interface for convenience.
 * All provider implementations must satisfy this contract.
 */
export type { DogeApiProvider };
/**
 * Provider health status — used by failover logic to track provider reliability.
 */
export interface ProviderHealth {
    name: string;
    healthy: boolean;
    lastError?: string;
    lastErrorAt?: number;
    /** How long to consider provider unhealthy after a failure (ms) */
    unhealthyDurationMs: number;
    consecutiveFailures: number;
    totalRequests: number;
    totalFailures: number;
}
/**
 * Create initial health state for a provider.
 */
export declare function createProviderHealth(name: string, unhealthyDurationMs?: number): ProviderHealth;
/**
 * Mark a provider as failed — updates health tracking.
 */
export declare function markProviderFailed(health: ProviderHealth, error: string): void;
/**
 * Mark a provider as succeeded — resets consecutive failure count.
 */
export declare function markProviderSuccess(health: ProviderHealth): void;
/**
 * Check if a provider should be considered healthy right now.
 */
export declare function isProviderHealthy(health: ProviderHealth): boolean;
//# sourceMappingURL=provider.d.ts.map