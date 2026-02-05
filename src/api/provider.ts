/**
 * DOGE Wallet — Abstract API Provider Interface
 *
 * All blockchain API providers implement this interface.
 * Switching providers = new class, same interface. Such modularity. 🐕
 */

import type { DogeApiProvider, UTXO, Transaction, NetworkInfo } from "../types.js";

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
export function createProviderHealth(
  name: string,
  unhealthyDurationMs: number = 60_000,
): ProviderHealth {
  return {
    name,
    healthy: true,
    unhealthyDurationMs,
    consecutiveFailures: 0,
    totalRequests: 0,
    totalFailures: 0,
  };
}

/**
 * Mark a provider as failed — updates health tracking.
 */
export function markProviderFailed(health: ProviderHealth, error: string): void {
  health.healthy = false;
  health.lastError = error;
  health.lastErrorAt = Date.now();
  health.consecutiveFailures++;
  health.totalFailures++;
  health.totalRequests++;
}

/**
 * Mark a provider as succeeded — resets consecutive failure count.
 */
export function markProviderSuccess(health: ProviderHealth): void {
  health.healthy = true;
  health.consecutiveFailures = 0;
  health.totalRequests++;
}

/**
 * Check if a provider should be considered healthy right now.
 */
export function isProviderHealthy(health: ProviderHealth): boolean {
  if (health.healthy) return true;

  // Check if unhealthy duration has elapsed — give it another chance
  if (health.lastErrorAt) {
    const elapsed = Date.now() - health.lastErrorAt;
    if (elapsed >= health.unhealthyDurationMs) {
      return true; // Time to retry
    }
  }

  return false;
}
