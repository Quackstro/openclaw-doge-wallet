/**
 * DOGE Wallet — BlockCypher API Provider
 *
 * Primary API provider for DOGE blockchain data.
 * Base URL: https://api.blockcypher.com/v1/doge/main
 * Free tier: 200 req/hr (no key), 2000 req/hr (with key)
 *
 * Much BlockCypher. Very reliable. Wow. 🐕
 */
import { ProviderError, RateLimitError } from "../errors.js";
// ============================================================================
// Response Validation Helpers
// ============================================================================
/**
 * Validate that a value is a non-negative finite number.
 * Throws ProviderError if validation fails.
 */
function validateNumber(value, name) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new ProviderError("blockcypher", `Invalid ${name} in response`);
    }
    return value;
}
/**
 * Validate that a value is a string.
 * Throws ProviderError if validation fails.
 */
function validateString(value, name) {
    if (typeof value !== 'string') {
        throw new ProviderError("blockcypher", `Invalid ${name} in response`);
    }
    return value;
}
export class BlockCypherProvider {
    name = "blockcypher";
    baseUrl;
    apiToken;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.apiToken = config.apiToken;
    }
    /**
     * Generate P2PKH scriptPubKey from a DOGE address.
     * Used when BlockCypher doesn't return the script field.
     * P2PKH script format: OP_DUP OP_HASH160 <20-byte-pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
     * Hex: 76a914 + <40-char-hex-pubKeyHash> + 88ac
     */
    generateP2PKHScript(address) {
        // Dogecoin P2PKH addresses start with 'D' (mainnet) or 'n' (testnet)
        // We need to decode the address to get the pubKeyHash
        // Base58Check decode: version (1 byte) + pubKeyHash (20 bytes) + checksum (4 bytes)
        const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        let num = BigInt(0);
        for (const char of address) {
            const idx = ALPHABET.indexOf(char);
            if (idx === -1)
                throw new ProviderError("blockcypher", `Invalid address character: ${char}`);
            num = num * BigInt(58) + BigInt(idx);
        }
        // Convert to hex, pad to 50 chars (25 bytes = version + pubKeyHash + checksum)
        let hex = num.toString(16).padStart(50, '0');
        // Extract pubKeyHash (bytes 1-20, skip version byte, ignore checksum)
        const pubKeyHash = hex.slice(2, 42);
        // Build P2PKH script: OP_DUP(76) OP_HASH160(a9) PUSH_20(14) <pubKeyHash> OP_EQUALVERIFY(88) OP_CHECKSIG(ac)
        return `76a914${pubKeyHash}88ac`;
    }
    // SECURITY [H-4]: BlockCypher only supports token in URL query params — HTTPS enforced
    // Risk: API token visible in server logs, browser history, and referrer headers.
    // Mitigation: baseUrl is always https://, and this is a server-side call (no browser exposure).
    /** Append API token to URL if configured */
    url(path, params) {
        const url = new URL(`${this.baseUrl}${path}`);
        if (!url.protocol.startsWith('https')) {
            throw new Error('BlockCypher API must use HTTPS');
        }
        if (this.apiToken) {
            url.searchParams.set("token", this.apiToken);
        }
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                url.searchParams.set(k, v);
            }
        }
        return url.toString();
    }
    /** Make a GET request with error handling */
    async get(path, params) {
        const urlStr = this.url(path, params);
        let res;
        try {
            res = await fetch(urlStr, {
                headers: { "Accept": "application/json" },
            });
        }
        catch (err) {
            throw new ProviderError("blockcypher", `Network error: ${err.message}`);
        }
        if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after");
            throw new RateLimitError("blockcypher", retryAfter ? parseInt(retryAfter) * 1000 : undefined);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new ProviderError("blockcypher", `HTTP ${res.status}: ${body.slice(0, 500)}`, res.status);
        }
        const json = (await res.json());
        // BlockCypher sometimes returns 200 with an error body instead of a proper HTTP error code
        if (json && typeof json === "object" && "error" in json && json.error) {
            const errMsg = String(json.error);
            if (/limit/i.test(errMsg)) {
                throw new RateLimitError("blockcypher");
            }
            throw new ProviderError("blockcypher", `API error: ${errMsg.slice(0, 500)}`);
        }
        return json;
    }
    async getBalance(address) {
        const data = await this.get(`/addrs/${address}/balance`);
        return {
            confirmed: validateNumber(data.balance, "balance"),
            unconfirmed: validateNumber(data.unconfirmed_balance, "unconfirmed_balance"),
        };
    }
    async getUtxos(address) {
        const data = await this.get(`/addrs/${address}`, { unspentOnly: "true" });
        const utxos = [];
        // Confirmed UTXOs
        if (data.txrefs) {
            for (const ref of data.txrefs) {
                // Generate P2PKH script if BlockCypher doesn't return it
                const scriptPubKey = ref.script && ref.script.length > 0
                    ? ref.script
                    : this.generateP2PKHScript(address);
                utxos.push({
                    txid: validateString(ref.tx_hash, "tx_hash"),
                    vout: validateNumber(ref.tx_output_n, "tx_output_n"),
                    address,
                    amount: validateNumber(ref.value, "value"),
                    scriptPubKey,
                    confirmations: validateNumber(ref.confirmations, "confirmations"),
                    blockHeight: ref.block_height,
                    locked: false,
                });
            }
        }
        // Unconfirmed UTXOs
        if (data.unconfirmed_txrefs) {
            for (const ref of data.unconfirmed_txrefs) {
                // Generate P2PKH script if BlockCypher doesn't return it
                const scriptPubKey = ref.script && ref.script.length > 0
                    ? ref.script
                    : this.generateP2PKHScript(address);
                utxos.push({
                    txid: validateString(ref.tx_hash, "tx_hash"),
                    vout: validateNumber(ref.tx_output_n, "tx_output_n"),
                    address,
                    amount: validateNumber(ref.value, "value"),
                    scriptPubKey,
                    confirmations: validateNumber(ref.confirmations, "confirmations"),
                    locked: false,
                });
            }
        }
        return utxos;
    }
    async getTransaction(txid) {
        const data = await this.get(`/txs/${txid}`);
        // Validate critical fields
        validateString(data.hash, "hash");
        validateNumber(data.confirmations, "confirmations");
        validateNumber(data.fees, "fees");
        return {
            txid: data.hash,
            blockHeight: data.block_height,
            confirmations: data.confirmations,
            timestamp: data.confirmed || data.received,
            inputs: data.inputs.map((inp) => ({
                address: inp.addresses?.[0] ?? "unknown",
                amount: validateNumber(inp.output_value, "input.output_value"),
            })),
            outputs: data.outputs.map((out) => ({
                address: out.addresses?.[0] ?? "unknown",
                amount: validateNumber(out.value, "output.value"),
                scriptType: out.script_type,
                script: out.script,
            })),
            fee: data.fees,
            totalInput: data.inputs.reduce((sum, i) => sum + validateNumber(i.output_value, "input.output_value"), 0),
            totalOutput: data.outputs.reduce((sum, o) => sum + validateNumber(o.value, "output.value"), 0),
        };
    }
    async getTransactions(address, limit) {
        const data = await this.get(`/addrs/${address}/full`, { limit: String(limit) });
        if (!data.txs)
            return [];
        return data.txs.map((tx) => ({
            txid: tx.hash,
            blockHeight: tx.block_height,
            confirmations: tx.confirmations,
            timestamp: tx.confirmed || tx.received,
            inputs: tx.inputs.map((inp) => ({
                address: inp.addresses?.[0] ?? "unknown",
                amount: inp.output_value,
            })),
            outputs: tx.outputs.map((out) => ({
                address: out.addresses?.[0] ?? "unknown",
                amount: out.value,
                scriptType: out.script_type,
                script: out.script,
            })),
            fee: tx.fees,
            totalInput: tx.inputs.reduce((sum, i) => sum + i.output_value, 0),
            totalOutput: tx.outputs.reduce((sum, o) => sum + o.value, 0),
        }));
    }
    async broadcastTx(rawHex) {
        const urlStr = this.url("/txs/push");
        let res;
        try {
            res = await fetch(urlStr, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                body: JSON.stringify({ tx: rawHex }),
            });
        }
        catch (err) {
            throw new ProviderError("blockcypher", `Broadcast network error: ${err.message}`);
        }
        // Handle rate limiting specifically (same as GET requests)
        if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after");
            throw new RateLimitError("blockcypher", retryAfter ? parseInt(retryAfter) * 1000 : undefined);
        }
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new ProviderError("blockcypher", `Broadcast failed (HTTP ${res.status}): ${body.slice(0, 500)}`, res.status);
        }
        const data = (await res.json());
        if (!data.tx?.hash) {
            throw new ProviderError("blockcypher", "Broadcast succeeded but no txid returned");
        }
        return { txid: data.tx.hash };
    }
    async getNetworkInfo() {
        const data = await this.get("");
        // BlockCypher returns fees in satoshis/koinu per KB
        // Convert to per-byte for our internal representation
        const highPerKb = data.high_fee_per_kb ?? 100000000;
        const medPerKb = data.medium_fee_per_kb ?? 100000000;
        const lowPerKb = data.low_fee_per_kb ?? 100000000;
        return {
            height: data.height,
            feeEstimate: {
                high: Math.ceil(highPerKb / 1000),
                medium: Math.ceil(medPerKb / 1000),
                low: Math.ceil(lowPerKb / 1000),
            },
        };
    }
}
//# sourceMappingURL=blockcypher.js.map