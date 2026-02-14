/**
 * DOGE Wallet — BlockCypher API Provider
 *
 * Primary API provider for DOGE blockchain data.
 * Base URL: https://api.blockcypher.com/v1/doge/main
 * Free tier: 200 req/hr (no key), 2000 req/hr (with key)
 *
 * Much BlockCypher. Very reliable. Wow. 🐕
 */

import type { DogeApiProvider, UTXO, Transaction, NetworkInfo, FeeEstimate } from "../types.js";
import type { BlockCypherConfig } from "../types.js";
import { ProviderError, RateLimitError } from "../errors.js";

// ============================================================================
// Response Validation Helpers
// ============================================================================

/**
 * Validate that a value is a non-negative finite number.
 * Throws ProviderError if validation fails.
 */
function validateNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ProviderError("blockcypher", `Invalid ${name} in response`);
  }
  return value;
}

/**
 * Validate that a value is a string.
 * Throws ProviderError if validation fails.
 */
function validateString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new ProviderError("blockcypher", `Invalid ${name} in response`);
  }
  return value;
}

export class BlockCypherProvider implements DogeApiProvider {
  readonly name = "blockcypher";
  private baseUrl: string;
  private apiToken: string | null;

  constructor(config: BlockCypherConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiToken = config.apiToken;
  }

  /**
   * Generate P2PKH scriptPubKey from a DOGE address.
   * Used when BlockCypher doesn't return the script field.
   * P2PKH script format: OP_DUP OP_HASH160 <20-byte-pubKeyHash> OP_EQUALVERIFY OP_CHECKSIG
   * Hex: 76a914 + <40-char-hex-pubKeyHash> + 88ac
   */
  private generateP2PKHScript(address: string): string {
    // Dogecoin P2PKH addresses start with 'D' (mainnet) or 'n' (testnet)
    // We need to decode the address to get the pubKeyHash
    // Base58Check decode: version (1 byte) + pubKeyHash (20 bytes) + checksum (4 bytes)
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt(0);
    for (const char of address) {
      const idx = ALPHABET.indexOf(char);
      if (idx === -1) throw new ProviderError("blockcypher", `Invalid address character: ${char}`);
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
  private url(path: string, params?: Record<string, string>): string {
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
  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const urlStr = this.url(path, params);
    let res: Response;
    try {
      res = await fetch(urlStr, {
        headers: { "Accept": "application/json" },
      });
    } catch (err: any) {
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

    const json = (await res.json()) as T & { error?: string };

    // BlockCypher sometimes returns 200 with an error body instead of a proper HTTP error code
    if (json && typeof json === "object" && "error" in json && json.error) {
      const errMsg = String(json.error);
      if (/limit/i.test(errMsg)) {
        throw new RateLimitError("blockcypher");
      }
      throw new ProviderError("blockcypher", `API error: ${errMsg.slice(0, 500)}`);
    }

    return json as T;
  }

  async getBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    const data = await this.get<{
      balance: number;
      unconfirmed_balance: number;
      final_balance: number;
    }>(`/addrs/${address}/balance`);

    return {
      confirmed: validateNumber(data.balance, "balance"),
      unconfirmed: validateNumber(data.unconfirmed_balance, "unconfirmed_balance"),
    };
  }

  async getUtxos(address: string): Promise<UTXO[]> {
    const data = await this.get<{
      txrefs?: Array<{
        tx_hash: string;
        tx_output_n: number;
        value: number;
        script: string;
        confirmations: number;
        block_height?: number;
      }>;
      unconfirmed_txrefs?: Array<{
        tx_hash: string;
        tx_output_n: number;
        value: number;
        script: string;
        confirmations: number;
      }>;
    }>(`/addrs/${address}`, { unspentOnly: "true" });

    const utxos: UTXO[] = [];

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

  async getTransaction(txid: string): Promise<Transaction> {
    const data = await this.get<{
      hash: string;
      block_height?: number;
      confirmations: number;
      received?: string;
      confirmed?: string;
      inputs: Array<{
        addresses?: string[];
        output_value: number;
      }>;
      outputs: Array<{
        addresses?: string[];
        value: number;
        script_type?: string;
        script?: string;
      }>;
      fees: number;
      total: number;
    }>(`/txs/${txid}`);

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

  async getTransactions(address: string, limit: number): Promise<Transaction[]> {
    const data = await this.get<{
      txs?: Array<{
        hash: string;
        block_height?: number;
        confirmations: number;
        received?: string;
        confirmed?: string;
        inputs: Array<{
          addresses?: string[];
          output_value: number;
        }>;
        outputs: Array<{
          addresses?: string[];
          value: number;
          script_type?: string;
          script?: string;
        }>;
        fees: number;
      }>;
    }>(`/addrs/${address}/full`, { limit: String(limit) });

    if (!data.txs) return [];

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

  async broadcastTx(rawHex: string): Promise<{ txid: string }> {
    const urlStr = this.url("/txs/push");
    let res: Response;
    try {
      res = await fetch(urlStr, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ tx: rawHex }),
      });
    } catch (err: any) {
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

    const data = (await res.json()) as { tx?: { hash: string } };
    if (!data.tx?.hash) {
      throw new ProviderError("blockcypher", "Broadcast succeeded but no txid returned");
    }

    return { txid: data.tx.hash };
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const data = await this.get<{
      height: number;
      high_fee_per_kb?: number;
      medium_fee_per_kb?: number;
      low_fee_per_kb?: number;
    }>("");

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
