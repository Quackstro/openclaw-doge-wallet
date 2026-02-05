/**
 * DOGE Wallet — Formatted Dashboard
 *
 * Produces a clean, compact Telegram-friendly dashboard string.
 * Works even when wallet is locked (shows limited info).
 *
 * Much dashboard. Very status. Wow. 🐕
 */
// ============================================================================
// Formatting helpers
// ============================================================================
function fmtDoge(n) {
    return n.toFixed(2);
}
function fmtDogeUsd(doge, usd) {
    if (usd != null) {
        return `${fmtDoge(doge)} DOGE (~$${usd.toFixed(2)})`;
    }
    return `${fmtDoge(doge)} DOGE`;
}
function truncAddr(address) {
    if (address.length <= 14)
        return address;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
function statusEmoji(status, frozen) {
    if (frozen)
        return "🧊 Frozen";
    switch (status) {
        case "not-initialized": return "🔴 Not Initialized";
        case "locked": return "🔒 Locked";
        case "unlocked": return "🔓 Unlocked";
    }
}
// ============================================================================
// Dashboard formatter
// ============================================================================
/**
 * Format a compact wallet dashboard string for Telegram.
 */
export function formatDashboard(data) {
    const lines = [];
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
//# sourceMappingURL=wallet-dashboard.js.map