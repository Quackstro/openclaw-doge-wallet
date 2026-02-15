/**
 * DOGE Wallet — SoChain API Provider (v3)
 *
 * Fallback API provider with testnet support.
 * Base URL: https://chain.so/api/v3
 * NOTE: SoChain v3 requires a paid API key. Get one at https://chain.so/api.
 * Testnet network: DOGETEST
 *
 * Much fallback. Very resilient. Wow. 🐕
 */
import { ProviderError, RateLimitError } from "../errors.js";
// ============================================================================
// Response Validation Helpers
// ============================================================================
/**
 * Validate and parse a numeric string to a non-negative number.
 * Throws ProviderError if validation fails.
 */
function validateNumericString(value, name) {
    if (typeof value !== 'string') {
        throw new ProviderError("sochain", `Invalid ${name} in response - expected string`);
    }
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < 0) {
        throw new ProviderError("sochain", `Invalid ${name} in response - not a valid number`);
    }
    return num;
}
/**
 * Validate that a value is a non-negative integer.
 * Throws ProviderError if validation fails.
 */
function validateNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ProviderError("sochain", `Invalid ${name} in response`);
    }
    return value;
}
/**
 * Validate that a value is a string.
 * Throws ProviderError if validation fails.
 */
function validateString(value, name) {
    if (typeof value !== 'string') {
        throw new ProviderError("sochain", `Invalid ${name} in response`);
    }
    return value;
}
export class SoChainProvider {
    name = "sochain";
    baseUrl;
    apiKey;
    network;
    constructor(config, network = "mainnet") {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.apiKey = config.apiKey;
        this.network = network === "testnet" ? "DOGETEST" : "DOGE";
    }
    /** Build headers including API key if configured */
    get headers() {
        const h = { "Accept": "application/json" };
        if (this.apiKey) {
            h["API-KEY"] = this.apiKey;
        }
        return h;
    }
    /** Make a GET request with error handling */
    async get(path) {
        const urlStr = `${this.baseUrl}${path}`;
        let res;
        try {
            res = await fetch(urlStr, {
                headers: this.headers,
                signal: AbortSignal.timeout(30_000), // 30s timeout to prevent hanging
            });
        }
        catch (err) {
            throw new ProviderError("sochain", `Network error: ${err.message}`);
        }
        if (res.status === 429) {
            throw new RateLimitError("sochain");
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            // Check for API key errors specifically
            if (body.includes("API Key invalid") || body.includes("account access expired") || body.includes("request limit")) {
                throw new ProviderError("sochain", "SoChain v3 requires a paid API key. Configure one in your plugin settings or get one at https://chain.so/api", res.status);
            }
            throw new ProviderError("sochain", `HTTP ${res.status}: ${body.slice(0, 500)}`, res.status);
        }
        const data = (await res.json());
        // SoChain v3 wraps responses in { status, data } format
        if (data.status === "fail") {
            const errMsg = data.data?.error_message || "Unknown SoChain error";
            throw new ProviderError("sochain", errMsg);
        }
        return data;
    }
    async getBalance(address) {
        // SoChain v3 endpoint: /balance/{network}/{address}
        const data = await this.get(`/balance/${this.network}/${address}`);
        // SoChain returns balances as decimal DOGE strings — validate and convert to koinu
        const confirmed = Math.round(validateNumericString(data.data?.confirmed, "confirmed") * 1e8);
        const unconfirmed = Math.round(validateNumericString(data.data?.unconfirmed, "unconfirmed") * 1e8);
        return { confirmed, unconfirmed };
    }
    async getUtxos(address) {
        // SoChain v3 endpoint: /unspent_outputs/{network}/{address}/{page}
        const data = await this.get(`/unspent_outputs/${this.network}/${address}/1`);
        if (!data.data?.outputs) {
            return [];
        }
        return data.data.outputs.map((out) => ({
            txid: validateString(out.hash, "hash"),
            vout: validateNumber(out.index, "index"),
            address,
            amount: Math.round(validateNumericString(out.value, "value") * 1e8),
            scriptPubKey: out.script || "",
            confirmations: validateNumber(out.confirmations, "confirmations"),
            blockHeight: out.block ?? undefined,
            locked: false,
        }));
    }
    async getTransaction(txid) {
        // SoChain v3 endpoint: /transaction/{network}/{txid}
        const data = await this.get(`/transaction/${this.network}/${txid}`);
        const tx = data.data;
        // Validate critical fields
        validateString(tx.hash, "hash");
        validateNumber(tx.confirmations, "confirmations");
        const inputs = tx.inputs.map((inp) => ({
            address: inp.address || "unknown",
            amount: Math.round(validateNumericString(inp.value, "input.value") * 1e8),
        }));
        const outputs = tx.outputs.map((out) => ({
            address: out.address || "unknown",
            amount: Math.round(validateNumericString(out.value, "output.value") * 1e8),
            scriptType: out.type,
            script: out.script,
        }));
        return {
            txid: tx.hash,
            blockHeight: tx.block ?? undefined,
            confirmations: tx.confirmations,
            timestamp: tx.time ? new Date(tx.time * 1000).toISOString() : undefined,
            inputs,
            outputs,
            fee: Math.round(validateNumericString(tx.fee, "fee") * 1e8),
            totalInput: inputs.reduce((sum, i) => sum + i.amount, 0),
            totalOutput: outputs.reduce((sum, o) => sum + o.amount, 0),
        };
    }
    async getTransactions(address, limit) {
        // SoChain v3 endpoint: /transactions/{network}/{address}/{page}
        const data = await this.get(`/transactions/${this.network}/${address}/1`);
        if (!data.data?.transactions) {
            return [];
        }
        // SoChain transaction list format is simplified — use txids to get full details
        const txids = data.data.transactions.slice(0, limit).map((t) => t.hash);
        const transactions = [];
        for (const txid of txids) {
            try {
                const tx = await this.getTransaction(txid);
                transactions.push(tx);
            }
            catch {
                // Skip failed individual tx lookups
            }
        }
        return transactions;
    }
    async broadcastTx(rawHex) {
        // SoChain v3 endpoint: POST /send_tx/{network}
        const urlStr = `${this.baseUrl}/send_tx/${this.network}`;
        let res;
        try {
            res = await fetch(urlStr, {
                method: "POST",
                headers: {
                    ...this.headers,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ tx_hex: rawHex }),
                signal: AbortSignal.timeout(30_000), // 30s timeout
            });
        }
        catch (err) {
            throw new ProviderError("sochain", `Broadcast network error: ${err.message}`);
        }
        // Handle rate limiting specifically
        if (res.status === 429) {
            throw new RateLimitError("sochain");
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            // Check for API key errors specifically
            if (body.includes("API Key invalid") || body.includes("account access expired") || body.includes("request limit")) {
                throw new ProviderError("sochain", "SoChain v3 requires a paid API key. Configure one in your plugin settings or get one at https://chain.so/api", res.status);
            }
            throw new ProviderError("sochain", `Broadcast failed (HTTP ${res.status}): ${body.slice(0, 500)}`, res.status);
        }
        const data = (await res.json());
        if (data.status === "fail") {
            throw new ProviderError("sochain", "Broadcast failed - transaction rejected");
        }
        const txid = data.data?.hash || data.data?.txid;
        if (!txid) {
            throw new ProviderError("sochain", "Broadcast succeeded but no txid returned");
        }
        return { txid };
    }
    async getNetworkInfo() {
        // SoChain v3 endpoint: /network_info/{network}
        // DOGE standard fee is 1 DOGE/KB
        const STANDARD_FEE_PER_KB = 100000000; // 1 DOGE per KB in koinu
        try {
            const data = await this.get(`/network_info/${this.network}`);
            return {
                height: validateNumber(data.data?.blocks, "blocks"),
                feeEstimate: {
                    high: Math.ceil(STANDARD_FEE_PER_KB / 1000),
                    medium: Math.ceil(STANDARD_FEE_PER_KB / 1000),
                    low: Math.ceil((STANDARD_FEE_PER_KB * 0.5) / 1000),
                },
            };
        }
        catch {
            // Fallback if network info endpoint fails
            return {
                height: 0,
                feeEstimate: {
                    high: Math.ceil(STANDARD_FEE_PER_KB / 1000),
                    medium: Math.ceil(STANDARD_FEE_PER_KB / 1000),
                    low: Math.ceil((STANDARD_FEE_PER_KB * 0.5) / 1000),
                },
            };
        }
    }
}
//# sourceMappingURL=sochain.js.map