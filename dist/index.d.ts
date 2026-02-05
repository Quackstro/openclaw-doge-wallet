/**
 * DOGE Wallet — OpenClaw Plugin Entry Point (Phase 6: Hardening)
 *
 * Registers tools, commands, and services for the Dogecoin wallet.
 * Phase 1: wallet init, recover, lock/unlock, address display.
 * Phase 2: UTXO tracking, real balance, coin selection, consolidation.
 * Phase 3: Transaction building, signing, broadcasting, spending policy.
 * Phase 4: Notifications, receive monitor, dashboard, export, polish.
 * Phase 5: Agent-to-Agent micro-transaction protocol.
 * Phase 6: Security hardening - rate limiting, input sanitization, preflight checks.
 *
 * Much plugin. Very crypto. Wow. 🐕
 */
declare const dogeWalletPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "service";
    register(api: any): void;
};
export default dogeWalletPlugin;
//# sourceMappingURL=index.d.ts.map