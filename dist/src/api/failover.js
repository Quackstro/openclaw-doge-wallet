/**
 * DOGE Wallet — Multi-Provider Failover
 *
 * Try primary provider first, fall back to secondary on failure.
 * Health tracking prevents hammering unhealthy providers.
 *
 * Much resilient. Very failover. Wow. 🐕
 */
import { createProviderHealth, markProviderFailed, markProviderSuccess, isProviderHealthy, } from "./provider.js";
import { ProviderUnavailableError } from "../errors.js";
export class FailoverProvider {
    name = "failover";
    primary;
    fallback;
    primaryHealth;
    fallbackHealth;
    log;
    constructor(opts) {
        this.primary = opts.primary;
        this.fallback = opts.fallback;
        const dur = opts.unhealthyDurationMs ?? 60_000;
        this.primaryHealth = createProviderHealth(opts.primary.name, dur);
        if (opts.fallback) {
            this.fallbackHealth = createProviderHealth(opts.fallback.name, dur);
        }
        this.log = opts.log ?? (() => { });
    }
    /** Execute a method with failover logic */
    async withFailover(method, fn) {
        const providers = [];
        // Add healthy providers first (prefer healthy ones)
        if (isProviderHealthy(this.primaryHealth)) {
            providers.push({ provider: this.primary, health: this.primaryHealth });
        }
        if (this.fallback && this.fallbackHealth && isProviderHealthy(this.fallbackHealth)) {
            providers.push({ provider: this.fallback, health: this.fallbackHealth });
        }
        // Add unhealthy providers at the end as last resort
        // This ensures we always try both providers, even if one was recently marked unhealthy
        if (!isProviderHealthy(this.primaryHealth)) {
            providers.push({ provider: this.primary, health: this.primaryHealth });
        }
        if (this.fallback && this.fallbackHealth && !isProviderHealthy(this.fallbackHealth)) {
            providers.push({ provider: this.fallback, health: this.fallbackHealth });
        }
        if (providers.length === 0) {
            throw new ProviderUnavailableError([this.primary.name, this.fallback?.name ?? "none"]);
        }
        // Log which providers will be tried
        const providerNames = providers.map((p) => {
            const healthStatus = isProviderHealthy(p.health) ? "healthy" : "unhealthy";
            return `${p.provider.name}(${healthStatus})`;
        });
        this.log("info", `doge-wallet: ${method} — trying providers: [${providerNames.join(", ")}]`);
        let lastError;
        for (let i = 0; i < providers.length; i++) {
            const { provider, health } = providers[i];
            const isLastProvider = i === providers.length - 1;
            try {
                this.log("info", `doge-wallet: ${method} — attempting ${provider.name}...`);
                const result = await fn(provider);
                markProviderSuccess(health);
                this.log("info", `doge-wallet: ${method} — ${provider.name} succeeded`);
                return result;
            }
            catch (err) {
                lastError = err;
                markProviderFailed(health, err.message ?? String(err));
                this.log("warn", `doge-wallet: ${provider.name}.${method} failed: ${err.message ?? err}. ` +
                    (isLastProvider ? "No more providers." : "Trying next provider..."));
            }
        }
        throw lastError ?? new ProviderUnavailableError([this.primary.name]);
    }
    async getBalance(address) {
        return this.withFailover("getBalance", (p) => p.getBalance(address));
    }
    async getUtxos(address) {
        return this.withFailover("getUtxos", (p) => p.getUtxos(address));
    }
    async getTransaction(txid) {
        return this.withFailover("getTransaction", (p) => p.getTransaction(txid));
    }
    async getTransactions(address, limit) {
        return this.withFailover("getTransactions", (p) => p.getTransactions(address, limit));
    }
    async broadcastTx(rawHex) {
        return this.withFailover("broadcastTx", (p) => p.broadcastTx(rawHex));
    }
    async getNetworkInfo() {
        return this.withFailover("getNetworkInfo", (p) => p.getNetworkInfo());
    }
    /** Get current health status of all providers */
    getHealthStatus() {
        return {
            primary: { ...this.primaryHealth },
            fallback: this.fallbackHealth ? { ...this.fallbackHealth } : undefined,
        };
    }
}
//# sourceMappingURL=failover.js.map