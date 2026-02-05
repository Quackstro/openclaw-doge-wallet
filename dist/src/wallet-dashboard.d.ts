/**
 * DOGE Wallet — Formatted Dashboard
 *
 * Produces a clean, compact Telegram-friendly dashboard string.
 * Works even when wallet is locked (shows limited info).
 *
 * Much dashboard. Very status. Wow. 🐕
 */
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
/**
 * Format a compact wallet dashboard string for Telegram.
 */
export declare function formatDashboard(data: DashboardData): string;
//# sourceMappingURL=wallet-dashboard.d.ts.map