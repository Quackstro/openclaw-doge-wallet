/**
 * DOGE Wallet — Formatted Dashboard
 *
 * Produces a clean, compact Telegram-friendly dashboard string.
 * Works even when wallet is locked (shows limited info).
 *
 * Much dashboard. Very status. Wow. 🐕
 */

// ============================================================================
// Types
// ============================================================================

export interface DashboardData {
  /** Wallet lifecycle state */
  status: "not-initialized" | "locked" | "unlocked";
  /** Whether the policy engine has frozen sends */
  frozen: boolean;
  /** Network: mainnet / testnet */
  network: "mainnet" | "testnet";
  /** Current receiving address (null if not initialized) */
  address: string | null;
  /** Confirmed balance in DOGE */
  confirmedDoge: number;
  /** Unconfirmed balance in DOGE */
  unconfirmedDoge: number;
  /** Total balance in DOGE */
  totalDoge: number;
  /** USD equivalent of total balance (null if price unavailable) */
  usd: number | null;
  /** Number of confirmed UTXOs */
  confirmedUtxos: number;
  /** Number of unconfirmed UTXOs */
  unconfirmedUtxos: number;
  /** DOGE spent today */
  dailySpentDoge: number;
  /** Daily limit in DOGE */
  dailyLimitDoge: number;
  /** Number of pending approvals */
  pendingApprovals: number;
  /** Number of transactions actively confirming */
  trackingCount: number;
  /** Current DOGE price in USD (null if unavailable) */
  dogePrice: number | null;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function fmtDoge(n: number): string {
  return n.toFixed(2);
}

function fmtDogeUsd(doge: number, usd: number | null): string {
  if (usd != null) {
    return `${fmtDoge(doge)} DOGE (~$${usd.toFixed(2)})`;
  }
  return `${fmtDoge(doge)} DOGE`;
}

function truncAddr(address: string): string {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function statusEmoji(status: DashboardData["status"], frozen: boolean): string {
  if (frozen) return "🧊 Frozen";
  switch (status) {
    case "not-initialized": return "🔴 Not Initialized";
    case "locked":          return "🔒 Locked";
    case "unlocked":        return "🔓 Unlocked";
  }
}

// ============================================================================
// Dashboard formatter
// ============================================================================

/**
 * Format a compact wallet dashboard string for Telegram.
 */
export function formatDashboard(data: DashboardData): string {
  const lines: string[] = [];

  lines.push("🐕 DOGE Wallet");
  lines.push("━━━━━━━━━━━━━━━━━━━━");

  // Status
  lines.push(`🐕 Status: ${statusEmoji(data.status, data.frozen)}`);

  // Balance (even if locked, show last known)
  lines.push(`💰 Balance: ${fmtDogeUsd(data.totalDoge, data.usd)}`);
  if (data.unconfirmedDoge > 0) {
    lines.push(`   ⏳ Unconfirmed: +${fmtDoge(data.unconfirmedDoge)} DOGE`);
  }

  // UTXOs
  const utxoTotal = data.confirmedUtxos + data.unconfirmedUtxos;
  lines.push(`📊 UTXOs: ${data.confirmedUtxos} confirmed, ${data.unconfirmedUtxos} unconfirmed (${utxoTotal} total)`);

  // Daily spending
  lines.push(`📤 Today: ${fmtDoge(data.dailySpentDoge)} / ${fmtDoge(data.dailyLimitDoge)} DOGE`);

  // Pending approvals
  if (data.pendingApprovals > 0) {
    lines.push(`⏳ Pending approvals: ${data.pendingApprovals}`);
  }

  // Tracking
  if (data.trackingCount > 0) {
    lines.push(`🔄 Tracking: ${data.trackingCount} tx confirming`);
  }

  // Policy
  lines.push(`🔐 Policy: ${data.frozen ? "🧊 FROZEN" : "active"}`);

  // Address
  if (data.address) {
    lines.push(`📍 Address: ${truncAddr(data.address)}`);
  }

  // Price
  if (data.dogePrice != null) {
    lines.push(`💱 Price: $${data.dogePrice.toFixed(4)} / DOGE`);
  }

  // Network
  lines.push(`🌐 Network: ${data.network}`);

  lines.push("");
  lines.push("Much wallet. Very status. Wow. 🐕");

  return lines.join("\n");
}
