/**
 * DOGE Wallet — Transaction Broadcaster
 *
 * Broadcasts signed transactions to the Dogecoin network with retry logic.
 * Uses the failover provider for resilience.
 *
 * Retry: 3 attempts with exponential backoff (1s, 3s, 9s).
 * Handles: already-broadcast (idempotent), double-spend, fee-too-low.
 *
 * Much broadcast. Very network. Wow. 🐕
 */

import { createHash } from "node:crypto";
import type { DogeApiProvider } from "../types.js";
import { WalletError } from "../errors.js";
import { broadcastViaP2P } from "../p2p/broadcaster.js";

// ============================================================================
// Types
// ============================================================================

export interface BroadcastResult {
  /** Transaction ID */
  txid: string;
  /** Whether broadcast was successful */
  success: boolean;
  /** Number of attempts made */
  attempts: number;
  /** Provider that successfully broadcast the tx */
  provider?: string;
}

export interface BroadcastOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000) — multiplied by 3 each retry */
  baseDelayMs?: number;
  /** Whether to verify the tx appears on network after broadcast (default: false) */
  verifyOnNetwork?: boolean;
  /** Logger function */
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

// ============================================================================
// Error detection helpers
// ============================================================================

/** Check if the error indicates the tx was already broadcast (idempotent) */
function isAlreadyBroadcast(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("already known") ||
    lower.includes("already in the mempool") ||
    lower.includes("transaction already exists") ||
    lower.includes("txn-already-in-mempool") ||
    lower.includes("already in block chain") ||
    lower.includes("txn-already-known")
  );
}

/** Check if the error indicates a double-spend attempt */
function isDoubleSpend(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("double spend") ||
    lower.includes("txn-mempool-conflict") ||
    lower.includes("bad-txns-inputs-missingorspent") ||
    lower.includes("missing inputs") ||
    lower.includes("inputs-missingorspent")
  );
}

/** Check if the error indicates insufficient fee */
function isFeeTooLow(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("fee") && lower.includes("low") ||
    lower.includes("min relay fee not met") ||
    lower.includes("insufficient fee") ||
    lower.includes("mempool min fee not met")
  );
}

// ============================================================================
// Broadcaster
// ============================================================================

/**
 * Broadcast a signed transaction to the Dogecoin network.
 *
 * @param signedTxHex - Signed transaction hex
 * @param provider - API provider (typically the failover provider)
 * @param options - Broadcast options
 * @returns BroadcastResult
 * @throws WalletError on permanent failure (double-spend, fee-too-low)
 */
export async function broadcastTransaction(
  signedTxHex: string,
  provider: DogeApiProvider,
  options: BroadcastOptions = {},
): Promise<BroadcastResult> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const log = options.log ?? (() => {});

  // ---- Step 1: Try P2P broadcast first (no API dependency) ----
  try {
    log("info", "doge-wallet: attempting P2P broadcast first...");
    const p2pResult = await broadcastViaP2P(signedTxHex, "mainnet", log);
    if (p2pResult.success) {
      log("info", `doge-wallet: P2P broadcast succeeded (${p2pResult.peersReached} peers reached)`);
      // P2P doesn't return a txid from the network — compute it from the raw tx
      const txid = computeTxid(signedTxHex);
      return {
        txid,
        success: true,
        attempts: 1,
        provider: `p2p (${p2pResult.peersReached} peers)`,
      };
    }
    log("warn", "doge-wallet: P2P broadcast did not reach enough peers, falling back to API providers...");
  } catch (p2pErr: unknown) {
    const p2pMsg = p2pErr instanceof Error ? p2pErr.message : String(p2pErr);
    log("warn", `doge-wallet: P2P broadcast failed: ${p2pMsg}, falling back to API providers...`);
  }

  // ---- Step 2: Fall back to API providers with retry logic ----
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await provider.broadcastTx(signedTxHex);

      log("info", `doge-wallet: tx broadcast success on attempt ${attempt}: ${result.txid}`);

      return {
        txid: result.txid,
        success: true,
        attempts: attempt,
        provider: provider.name,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = err instanceof Error ? err : new Error(errMsg);

      // Handle idempotent case: tx already broadcast
      if (isAlreadyBroadcast(errMsg)) {
        log("info", `doge-wallet: tx already broadcast (idempotent): ${errMsg}`);
        // Extract txid from the signed tx hex if possible
        // For idempotent case, we consider it success
        return {
          txid: "already-broadcast",
          success: true,
          attempts: attempt,
          provider: provider.name,
        };
      }

      // Non-retriable errors — fail immediately
      if (isDoubleSpend(errMsg)) {
        throw new WalletError(
          "DOUBLE_SPEND",
          `Double spend detected — inputs already spent: ${errMsg}`,
        );
      }

      if (isFeeTooLow(errMsg)) {
        throw new WalletError(
          "FEE_TOO_LOW",
          `Transaction fee too low for network acceptance: ${errMsg}`,
        );
      }

      log(
        "warn",
        `doge-wallet: broadcast attempt ${attempt}/${maxRetries} failed: ${errMsg}`,
      );

      // Wait before retrying (exponential backoff: 1s, 3s, 9s)
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(3, attempt - 1);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — try Blockchair as last-resort fallback
  log("warn", "doge-wallet: all providers failed, trying Blockchair fallback broadcast...");
  try {
    const blockchairResult = await broadcastViaBlockchair(signedTxHex);
    log("info", `doge-wallet: Blockchair fallback broadcast succeeded: ${blockchairResult.txid}`);
    return {
      txid: blockchairResult.txid,
      success: true,
      attempts: maxRetries + 1,
      provider: "blockchair-fallback",
    };
  } catch (bcErr: any) {
    log("error", `doge-wallet: Blockchair fallback also failed: ${bcErr.message}`);
  }

  throw new WalletError(
    "BROADCAST_FAILED",
    `Transaction broadcast failed after ${maxRetries} attempts (+ Blockchair fallback): ${lastError?.message ?? "unknown error"}. Much sadness. 🐕`,
  );
}

/**
 * Verify that a transaction appears on the network.
 * Used after broadcast to confirm the tx was accepted.
 *
 * @param txid - Transaction ID to verify
 * @param provider - API provider
 * @param timeoutMs - Max time to wait in ms (default: 30000)
 * @param pollIntervalMs - Time between polls in ms (default: 5000)
 * @returns true if the tx was found on the network
 */
export async function verifyBroadcast(
  txid: string,
  provider: DogeApiProvider,
  timeoutMs: number = 30_000,
  pollIntervalMs: number = 5_000,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const tx = await provider.getTransaction(txid);
      if (tx && tx.txid === txid) {
        return true;
      }
    } catch {
      // Not found yet — keep polling
    }

    await sleep(pollIntervalMs);
  }

  return false;
}

// ============================================================================
// Blockchair Fallback Broadcast
// ============================================================================

/**
 * Broadcast via Blockchair API as a last-resort fallback.
 * Free, no API key required. Endpoint: POST https://api.blockchair.com/dogecoin/push/transaction
 * Body: data=<hex> (form-encoded)
 */
async function broadcastViaBlockchair(signedTxHex: string): Promise<{ txid: string }> {
  const url = "https://api.blockchair.com/dogecoin/push/transaction";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: signedTxHex }),
    signal: AbortSignal.timeout(30_000), // 30s timeout
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Blockchair broadcast failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    data?: { transaction_hash?: string };
    context?: { code?: number; error?: string };
  };

  if (data.context?.error) {
    throw new Error(`Blockchair rejected tx: ${data.context.error}`);
  }

  const txid = data.data?.transaction_hash;
  if (!txid) {
    throw new Error("Blockchair broadcast succeeded but no txid returned");
  }

  return { txid };
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the txid from a raw signed transaction hex.
 * txid = reversed double-SHA256 of the raw tx bytes.
 */
function computeTxid(signedTxHex: string): string {
  const raw = Buffer.from(signedTxHex, "hex");
  const hash1 = createHash("sha256").update(raw).digest();
  const hash2 = createHash("sha256").update(hash1).digest();
  // Reverse for display (Bitcoin txid convention: little-endian hash)
  return Buffer.from(hash2).reverse().toString("hex");
}
