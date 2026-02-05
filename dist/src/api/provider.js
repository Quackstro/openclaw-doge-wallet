/**
 * DOGE Wallet — Abstract API Provider Interface
 *
 * All blockchain API providers implement this interface.
 * Switching providers = new class, same interface. Such modularity. 🐕
 */
/**
 * Create initial health state for a provider.
 */
export function createProviderHealth(name, unhealthyDurationMs = 60_000) {
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
export function markProviderFailed(health, error) {
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
export function markProviderSuccess(health) {
    health.healthy = true;
    health.consecutiveFailures = 0;
    health.totalRequests++;
}
/**
 * Check if a provider should be considered healthy right now.
 */
export function isProviderHealthy(health) {
    if (health.healthy)
        return true;
    // Check if unhealthy duration has elapsed — give it another chance
    if (health.lastErrorAt) {
        const elapsed = Date.now() - health.lastErrorAt;
        if (elapsed >= health.unhealthyDurationMs) {
            return true; // Time to retry
        }
    }
    return false;
}
//# sourceMappingURL=provider.js.map