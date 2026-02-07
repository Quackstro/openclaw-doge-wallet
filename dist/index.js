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
import { Type } from "@sinclair/typebox";
/* eslint-disable @typescript-eslint/no-explicit-any — PluginApi shape is dynamic */
import { parseDogeConfig } from "./src/config.js";
import { PriceService } from "./src/price.js";
import { AuditLog } from "./src/audit.js";
import { BlockCypherProvider } from "./src/api/blockcypher.js";
import { SoChainProvider } from "./src/api/sochain.js";
import { FailoverProvider } from "./src/api/failover.js";
import { WalletManager } from "./src/keys/manager.js";
import { UtxoManager } from "./src/utxo/manager.js";
import { selectCoins } from "./src/utxo/selection.js";
import { shouldConsolidate, getUtxoSummary } from "./src/utxo/consolidation.js";
import { buildTransaction } from "./src/tx/builder.js";
import { signTransaction } from "./src/tx/signer.js";
import { broadcastTransaction } from "./src/tx/broadcaster.js";
import { TransactionTracker } from "./src/tx/tracker.js";
import { PolicyEngine } from "./src/policy/engine.js";
import { LimitTracker } from "./src/policy/limits.js";
import { ApprovalQueue } from "./src/policy/approval.js";
import { WalletNotifier, LOW_BALANCE_CALLBACKS } from "./src/notifications.js";
import { AlertStateManager } from "./src/alert-state.js";
import { ReceiveMonitor } from "./src/receive-monitor.js";
import { formatDashboard } from "./src/wallet-dashboard.js";
import { isValidAddress } from "./src/keys/derivation.js";
import { WalletAlreadyInitializedError, WalletLockedError, WalletNotInitializedError, InvalidPassphraseError, InvalidMnemonicError, } from "./src/errors.js";
import { koinuToDoge, dogeToKoinu } from "./src/types.js";
// Phase 5: A2A Protocol imports
import { InvoiceManager, PaymentVerifier, CallbackSender, cleanupExpiredInvoices, OP_RETURN_PREFIX, } from "./src/a2a/index.js";
// Phase 6: Security modules
import { RateLimiter, validateAmount, validateAddress, validateCallbackUrl, sanitizeDescription, sanitizeErrorMessage, } from "./src/security/index.js";
// Secure file I/O
import { ensureSecureDataDir } from "./src/secure-fs.js";
// Phase 6: Mainnet configuration
import { applyMainnetSafetyDefaults, runMainnetPreflightChecks, validateMainnetConfig, } from "./src/mainnet-config.js";
// Phase 7: Onboarding flow
import { OnboardingFlow, deleteUserMessage, } from "./src/onboarding/index.js";
// ============================================================================
// Formatting Helpers (used throughout)
// ============================================================================
/**
 * Format DOGE amount with exactly 2 decimal places.
 */
function formatDoge(amount) {
    return amount.toFixed(2);
}
/**
 * Format DOGE with optional USD equivalent.
 */
function formatDogeUsd(doge, usd) {
    if (usd !== null) {
        return `${formatDoge(doge)} DOGE (~$${usd.toFixed(2)})`;
    }
    return `${formatDoge(doge)} DOGE`;
}
/**
 * Truncate a DOGE address for display.
 */
function truncAddr(address) {
    if (address.length <= 14)
        return address;
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
/**
 * Format a timestamp in ET (America/New_York).
 */
function formatET(isoStr) {
    try {
        return new Date(isoStr).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });
    }
    catch {
        return isoStr;
    }
}
// ============================================================================
// Plugin Definition
// ============================================================================
const dogeWalletPlugin = {
    id: "doge-wallet",
    name: "DOGE Wallet",
    description: "Dogecoin wallet for OpenClaw agents — hold, send, receive, and manage DOGE autonomously. " +
        "Much crypto. Very agent. Wow. 🐕",
    kind: "service",
    register(api) {
        // ------------------------------------------------------------------
        // Config
        // ------------------------------------------------------------------
        let cfg;
        try {
            cfg = parseDogeConfig(api.pluginConfig);
            // Phase 6: Apply mainnet safety defaults (enforces minimum security on mainnet)
            cfg = applyMainnetSafetyDefaults(cfg);
        }
        catch (err) {
            api.logger.error(`doge-wallet: config error: ${err.message}`);
            return;
        }
        const resolvedDataDir = api.resolvePath?.(cfg.dataDir) ??
            cfg.dataDir.replace("~", process.env.HOME ?? "/home/user");
        // Ensure data directory tree exists with secure permissions (700/600)
        // This runs on every startup to harden permissions even on existing installs
        ensureSecureDataDir(resolvedDataDir).catch((err) => {
            api.logger.warn(`doge-wallet: failed to secure data dir: ${err.message}`);
        });
        // Helper logger that wraps api.logger
        const log = (level, msg) => {
            if (api.logger?.[level]) {
                api.logger[level](msg);
            }
        };
        // ------------------------------------------------------------------
        // API Providers
        // ------------------------------------------------------------------
        const primaryProvider = createProvider(cfg, cfg.api.primary, log);
        const fallbackProvider = cfg.api.fallback !== "none"
            ? createProvider(cfg, cfg.api.fallback, log)
            : undefined;
        const provider = new FailoverProvider({
            primary: primaryProvider,
            fallback: fallbackProvider,
            unhealthyDurationMs: 60_000,
            log,
        });
        // ------------------------------------------------------------------
        // Price Service
        // ------------------------------------------------------------------
        const priceService = new PriceService(cfg.api.priceApi, log);
        // ------------------------------------------------------------------
        // Rate Limiter (Phase 6)
        // ------------------------------------------------------------------
        const rateLimiter = new RateLimiter(undefined, log, resolvedDataDir);
        // Save rate limiter state on shutdown
        const shutdownHandler = () => {
            rateLimiter.saveState();
        };
        process.on('SIGTERM', shutdownHandler);
        process.on('SIGINT', shutdownHandler);
        process.on('beforeExit', shutdownHandler);
        // ------------------------------------------------------------------
        // Audit Log
        // ------------------------------------------------------------------
        const auditLog = new AuditLog(resolvedDataDir, log);
        // ------------------------------------------------------------------
        // Wallet Manager
        // ------------------------------------------------------------------
        const walletManager = new WalletManager(resolvedDataDir, cfg.network, log);
        // ------------------------------------------------------------------
        // Onboarding Flow (Phase 7)
        // ------------------------------------------------------------------
        const onboardingFlow = new OnboardingFlow({
            dataDir: resolvedDataDir,
            walletManager,
            log,
        });
        // ------------------------------------------------------------------
        // UTXO Manager
        // ------------------------------------------------------------------
        const utxoManager = new UtxoManager(resolvedDataDir, provider, log);
        // ------------------------------------------------------------------
        // A2A Protocol (Phase 5)
        // ------------------------------------------------------------------
        // Invoice Manager — initialized with placeholder address, updated when wallet unlocks
        const invoiceManager = new InvoiceManager({
            name: "OpenClaw Agent",
            address: "", // Will be updated when wallet is initialized
            operator: "OpenClaw",
            dataDir: resolvedDataDir,
            log,
        });
        // Payment Verifier — validates incoming payments
        const paymentVerifier = new PaymentVerifier({
            provider,
            ourAddress: "", // Will be updated when wallet is initialized
            network: cfg.network,
            log,
        });
        // Callback Sender — sends payment notifications to payees
        const callbackSender = new CallbackSender({ log });
        // ------------------------------------------------------------------
        // Notifier (Phase 4)
        // ------------------------------------------------------------------
        const notifier = new WalletNotifier(cfg.notifications, log);
        // ------------------------------------------------------------------
        // Low Balance Alert State Manager
        // ------------------------------------------------------------------
        const alertState = new AlertStateManager(resolvedDataDir, log);
        // Load alert state asynchronously (non-blocking)
        alertState.load().catch((err) => {
            log("warn", `doge-wallet: failed to load alert state: ${err.message}`);
        });
        // Wire up the notifier's send function.
        // Try the plugin API sendMessage if available; fall back to exec cli.
        const sendNotification = async (message) => {
            try {
                if (typeof api.sendMessage === "function") {
                    await api.sendMessage(message);
                    return;
                }
            }
            catch {
                // fall through to CLI
            }
            // Fallback: shell out to OpenClaw CLI
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileP = promisify(execFile);
            try {
                await execFileP("openclaw", [
                    "message",
                    "send",
                    "--channel",
                    "telegram",
                    "--target",
                    cfg.notifications.target,
                    "--message",
                    message,
                ], { timeout: 15_000 });
            }
            catch (cliErr) {
                log("warn", `doge-wallet: CLI notification fallback failed: ${cliErr.message ?? cliErr}`);
            }
        };
        // Rich message sender (supports inline keyboards for Telegram)
        const sendRichNotification = async (richMsg) => {
            log("info", `doge-wallet: sendRichNotification called, hasKeyboard=${!!richMsg.keyboard}`);
            log("info", `doge-wallet: api keys: ${Object.keys(api).join(', ')}`);
            try {
                // Use Telegram API directly with buttons support
                if (api.telegram?.sendMessageTelegram) {
                    const opts = {};
                    if (richMsg.keyboard) {
                        opts.buttons = richMsg.keyboard;
                        log("info", `doge-wallet: sending with buttons: ${JSON.stringify(richMsg.keyboard)}`);
                    }
                    await api.telegram.sendMessageTelegram(cfg.notifications.target, richMsg.text, opts);
                    log("info", "doge-wallet: api.telegram.sendMessageTelegram succeeded");
                    return;
                }
                log("warn", "doge-wallet: api.telegram.sendMessageTelegram not available");
            }
            catch (err) {
                log("warn", `doge-wallet: telegram send failed: ${err.message ?? err}, falling back to CLI`);
            }
            // Fallback: shell out to OpenClaw CLI with buttons support
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileP = promisify(execFile);
            try {
                const args = [
                    "message",
                    "send",
                    "--channel",
                    "telegram",
                    "--target",
                    cfg.notifications.target,
                    "--message",
                    richMsg.text,
                ];
                // Add buttons if present
                if (richMsg.keyboard && richMsg.keyboard.length > 0) {
                    args.push("--buttons", JSON.stringify(richMsg.keyboard));
                }
                await execFileP("openclaw", args, { timeout: 15_000 });
            }
            catch (cliErr) {
                log("warn", `doge-wallet: CLI notification fallback failed: ${cliErr.message ?? cliErr}`);
            }
        };
        notifier.setSendMessage(sendNotification);
        notifier.setSendRichMessage(sendRichNotification);
        // ------------------------------------------------------------------
        // Helper: Unlock UTXOs locked for a failed/unverified transaction
        // ------------------------------------------------------------------
        async function unlockUtxosForTx(txid) {
            const utxos = utxoManager.getUtxos();
            let unlockCount = 0;
            for (const utxo of utxos) {
                if (utxo.locked && utxo.lockedFor === txid) {
                    const ok = await utxoManager.unlockUtxo(utxo.txid, utxo.vout);
                    if (ok) {
                        unlockCount++;
                        log("info", `doge-wallet: unlocked UTXO ${utxo.txid}:${utxo.vout} ` +
                            `(${koinuToDoge(utxo.amount)} DOGE) — locked for failed/unverified tx ${txid}`);
                    }
                }
            }
            if (unlockCount > 0) {
                const balance = utxoManager.getBalance();
                log("info", `doge-wallet: unlocked ${unlockCount} UTXO(s) for tx ${txid} — ` +
                    `balance now ${koinuToDoge(balance.confirmed)} DOGE`);
            }
        }
        // ------------------------------------------------------------------
        // Transaction Tracker
        // ------------------------------------------------------------------
        const txTracker = new TransactionTracker(resolvedDataDir, provider, {
            onConfirmation: (txid, count) => {
                const tracked = txTracker.getStatus(txid);
                notifier.notifyConfirmation(txid, count, {
                    amountDoge: tracked?.amount ? koinuToDoge(tracked.amount) : undefined,
                    to: tracked?.to,
                }).catch(() => { });
            },
            onConfirmed: (txid) => {
                const tracked = txTracker.getStatus(txid);
                notifier.notifyConfirmation(txid, 6, {
                    amountDoge: tracked?.amount ? koinuToDoge(tracked.amount) : undefined,
                    to: tracked?.to,
                }).catch(() => { });
                log("info", `doge-wallet: ✅ tx ${txid} confirmed!`);
            },
            onFailed: (txid, reason) => {
                notifier.notifyError(`❌ TX ${txid.slice(0, 12)}… not found on network — transaction may have failed. ${reason}`).catch(() => { });
                log("warn", `doge-wallet: ❌ tx ${txid} failed: ${reason}`);
                // Unlock any UTXOs that were locked for this failed transaction
                unlockUtxosForTx(txid).catch((err) => {
                    log("error", `doge-wallet: failed to unlock UTXOs for failed tx ${txid}: ${err}`);
                });
            },
            onUnverified: (txid, reason) => {
                notifier.notifyError(`⚠️ Unable to verify TX ${txid.slice(0, 12)}… — APIs are degraded. Transaction may still be valid. ${reason}`).catch(() => { });
                log("warn", `doge-wallet: ⚠️ tx ${txid} unverified (API degradation): ${reason}`);
                // Unlock any UTXOs that were locked for this unverified transaction
                unlockUtxosForTx(txid).catch((err) => {
                    log("error", `doge-wallet: failed to unlock UTXOs for unverified tx ${txid}: ${err}`);
                });
            },
        }, log);
        const limitTracker = new LimitTracker(resolvedDataDir, cfg.policy.limits, log);
        const policyEngine = new PolicyEngine(cfg.policy, limitTracker);
        // SECURITY [H-3]: Pass ownerId from runtime config (notifications.target)
        // Never hardcode user IDs — this is an open source project
        // SECURITY [H-3]: ownerId MUST come from runtime config — never hardcode user IDs
        // If not configured, approvals will require explicit configuration before working
        const approvalOwnerId = cfg.notifications.target || "<OWNER_ID_NOT_CONFIGURED>";
        if (!cfg.notifications.target) {
            log("warn", "doge-wallet: notifications.target not set — approval auth will reject all callers until configured");
        }
        const approvalQueue = new ApprovalQueue(resolvedDataDir, approvalOwnerId, log);
        // Freeze state persistence
        const freezeFilePath = `${resolvedDataDir}/freeze.json`;
        async function loadFreezeState() {
            try {
                const { readFile } = await import("node:fs/promises");
                const raw = await readFile(freezeFilePath, "utf-8");
                const state = JSON.parse(raw);
                if (state.frozen) {
                    policyEngine.freeze();
                    log("info", "doge-wallet: restored frozen state from disk");
                }
            }
            catch (err) {
                const e = err;
                if (e.code !== "ENOENT") {
                    log("warn", `doge-wallet: failed to load freeze state: ${e.message}`);
                }
            }
        }
        async function saveFreezeState() {
            try {
                const { secureWriteFile: swf } = await import("./src/secure-fs.js");
                await swf(freezeFilePath, JSON.stringify({ frozen: policyEngine.isFrozen() }));
            }
            catch (err) {
                log("error", `doge-wallet: failed to save freeze state: ${err.message}`);
            }
        }
        // ------------------------------------------------------------------
        // Receive Monitor (Phase 4)
        // ------------------------------------------------------------------
        const receiveMonitor = new ReceiveMonitor(resolvedDataDir, provider, {
            onReceive: (incomingTx) => {
                const amountDoge = koinuToDoge(incomingTx.amountKoinu);
                notifier.notifyReceive({
                    txid: incomingTx.txid,
                    address: incomingTx.fromAddress,
                    amountDoge,
                    usdValue: priceService.dogeToUsd(amountDoge),
                }).catch(() => { });
                auditLog.logReceive(incomingTx.txid, incomingTx.fromAddress, incomingTx.amountKoinu, incomingTx.confirmations ?? 0).catch(() => { });
            },
        }, log);
        // Timers
        let utxoRefreshTimer = null;
        const refreshIntervalMs = (cfg.utxo.refreshIntervalSeconds ?? 180) * 1000;
        let approvalExpiryTimer = null;
        // Low-balance alert interval from config (default 24 hours)
        const lowBalanceAlertIntervalHours = cfg.notifications.lowBalanceAlertIntervalHours ?? 24;
        // ------------------------------------------------------------------
        // Helper: Get balance info
        // ------------------------------------------------------------------
        async function getBalanceInfo() {
            const initialized = await walletManager.isInitialized();
            if (!initialized)
                return null;
            const address = await walletManager.getAddress();
            if (!address)
                return null;
            const balance = utxoManager.getBalance();
            const confirmedDoge = koinuToDoge(balance.confirmed);
            const unconfirmedDoge = koinuToDoge(balance.unconfirmed);
            const totalDoge = confirmedDoge + unconfirmedDoge;
            const usd = priceService.dogeToUsd(totalDoge);
            const utxos = utxoManager.getUtxos();
            return {
                confirmed: confirmedDoge,
                unconfirmed: unconfirmedDoge,
                total: totalDoge,
                usd,
                address,
                utxoCount: utxos.length,
                lastRefreshed: utxoManager.getLastRefreshed(),
                network: cfg.network,
            };
        }
        // ------------------------------------------------------------------
        // UTXO Refresh Helper (with low-balance check)
        // ------------------------------------------------------------------
        async function doUtxoRefresh() {
            const initialized = await walletManager.isInitialized();
            if (!initialized)
                return;
            const address = await walletManager.getAddress();
            if (!address)
                return;
            await utxoManager.refresh(address);
            // Check low balance
            const balance = utxoManager.getBalance();
            const totalDoge = koinuToDoge(balance.confirmed + balance.unconfirmed);
            const threshold = cfg.notifications.lowBalanceAlert;
            // Check if balance recovered above threshold — reset dismissed state
            if (totalDoge >= threshold) {
                await alertState.checkRecovery(totalDoge, threshold);
            }
            if (totalDoge < threshold && totalDoge > 0) {
                // Check alert state (dismissed/snoozed) AND interval
                if (!alertState.shouldAlertWithInterval(lowBalanceAlertIntervalHours)) {
                    return;
                }
                // Record and send notification
                // Snooze duration = half the alert interval
                const snoozeHours = Math.max(1, Math.floor(lowBalanceAlertIntervalHours / 2));
                const usdValue = priceService.dogeToUsd(totalDoge);
                await alertState.recordAlert(totalDoge);
                notifier.notifyLowBalance(totalDoge, threshold, snoozeHours, usdValue).catch(() => { });
            }
        }
        // ------------------------------------------------------------------
        // Helper: Get fee rate from config/network
        // ------------------------------------------------------------------
        async function getFeeRate() {
            try {
                const networkInfo = await provider.getNetworkInfo();
                const strategy = cfg.fees.strategy;
                return networkInfo.feeEstimate[strategy];
            }
            catch {
                return Math.ceil(cfg.fees.fallbackFeePerKb / 1000);
            }
        }
        // ------------------------------------------------------------------
        // Helper: Execute a send (build, sign, broadcast, track)
        // ------------------------------------------------------------------
        async function executeSend(to, amountDoge, reason, tier) {
            if (!walletManager.isUnlocked()) {
                throw new WalletLockedError();
            }
            const address = await walletManager.getAddress();
            if (!address)
                throw new WalletNotInitializedError();
            const amountKoinu = dogeToKoinu(amountDoge);
            const feeRate = await getFeeRate();
            const spendableUtxos = await utxoManager.getSpendableUtxos(cfg.utxo.minConfirmations);
            const selection = selectCoins(spendableUtxos, amountKoinu, feeRate);
            const txResult = buildTransaction({
                from: address,
                to,
                amount: amountKoinu,
                utxos: selection.selected,
                changeAddress: address,
                feeRate,
            });
            const privateKey = walletManager.getPrivateKey();
            let signResult;
            try {
                // Pass UTXOs to signer so it can reconstruct proper PublicKeyHashInput objects
                // (deserialization from hex creates generic Input objects that lack clearSignatures)
                signResult = signTransaction(txResult.rawTx, privateKey, cfg.network, selection.selected);
            }
            finally {
                // SECURITY [H-1]: Zero private key from memory on ALL paths (success + error)
                privateKey.fill(0);
            }
            for (const utxo of selection.selected) {
                await utxoManager.markSpent(utxo.txid, utxo.vout, signResult.txid);
            }
            let broadcastResult;
            try {
                broadcastResult = await broadcastTransaction(signResult.signedTx, provider, { log });
            }
            catch (err) {
                for (const utxo of selection.selected) {
                    await utxoManager.unlockUtxo(utxo.txid, utxo.vout);
                }
                throw err;
            }
            const txid = broadcastResult.txid === "already-broadcast" ? signResult.txid : broadcastResult.txid;
            // Optimistically add change output so balance is immediately correct
            const changeOutput = txResult.outputs.find((o) => o.isChange && o.amount > 0);
            if (changeOutput) {
                const changeVout = txResult.outputs.indexOf(changeOutput);
                await utxoManager.addUtxo({
                    txid,
                    vout: changeVout,
                    address: changeOutput.address,
                    scriptPubKey: "",
                    amount: changeOutput.amount,
                    confirmations: 0,
                    locked: false,
                });
            }
            limitTracker.recordSpend(amountKoinu + txResult.fee);
            txTracker.track(txid, { to, amount: amountKoinu, fee: txResult.fee });
            await auditLog.logSend(txid, to, amountKoinu, txResult.fee, tier, "broadcast", reason);
            // Notify (fire and forget)
            const feeDoge = koinuToDoge(txResult.fee);
            notifier.notifySend({
                txid,
                address: to,
                amountDoge,
                feeDoge,
                usdValue: priceService.dogeToUsd(amountDoge),
            }).catch(() => { });
            return { txid, fee: txResult.fee, feeDoge };
        }
        // ------------------------------------------------------------------
        // Helper: Build DashboardData from current state
        // ------------------------------------------------------------------
        async function buildDashboardData() {
            const initialized = await walletManager.isInitialized();
            const unlocked = walletManager.isUnlocked();
            const frozen = policyEngine.isFrozen();
            const balance = utxoManager.getBalance();
            const confirmedDoge = koinuToDoge(balance.confirmed);
            const unconfirmedDoge = koinuToDoge(balance.unconfirmed);
            const totalDoge = confirmedDoge + unconfirmedDoge;
            const utxos = utxoManager.getUtxos();
            const confirmedUtxos = utxos.filter((u) => u.confirmations >= 1 && !u.locked).length;
            const unconfirmedUtxos = utxos.filter((u) => u.confirmations < 1 && !u.locked).length;
            let address = null;
            if (initialized) {
                address = await walletManager.getAddress();
            }
            const status = !initialized
                ? "not-initialized"
                : unlocked
                    ? "unlocked"
                    : "locked";
            return {
                status,
                frozen,
                network: cfg.network,
                address,
                confirmedDoge,
                unconfirmedDoge,
                totalDoge,
                usd: priceService.dogeToUsd(totalDoge),
                confirmedUtxos,
                unconfirmedUtxos,
                dailySpentDoge: koinuToDoge(limitTracker.getDailySpent()),
                dailyLimitDoge: cfg.policy.limits.dailyMax,
                pendingApprovals: approvalQueue.getPending().length,
                trackingCount: txTracker.getActive().length,
                dogePrice: priceService.getPrice(),
            };
        }
        // ------------------------------------------------------------------
        // Subcommand handler: balance
        // ------------------------------------------------------------------
        async function handleWalletBalance() {
            const balanceInfo = await getBalanceInfo();
            if (!balanceInfo) {
                return {
                    text: "🐕 DOGE Wallet\n" +
                        "━━━━━━━━━━━━━━━━\n" +
                        "No wallet configured.\n" +
                        "Run /wallet init <passphrase> to get started.\n" +
                        "Such empty. Much potential. Wow.",
                };
            }
            // Trigger a refresh if never refreshed
            if (utxoManager.getUtxos().length === 0 && !utxoManager.getLastRefreshed()) {
                try {
                    await doUtxoRefresh();
                    const updated = await getBalanceInfo();
                    if (updated)
                        Object.assign(balanceInfo, updated);
                }
                catch { /* continue with stale data */ }
            }
            const unlocked = walletManager.isUnlocked();
            const lockStatus = unlocked ? "🔓 Unlocked" : "🔒 Locked";
            const frozen = policyEngine.isFrozen();
            const dailySpent = koinuToDoge(limitTracker.getDailySpent());
            const dailyMax = cfg.policy.limits.dailyMax;
            const lastRefreshed = balanceInfo.lastRefreshed
                ? formatET(balanceInfo.lastRefreshed)
                : "never";
            let text = "🐕 DOGE Wallet Balance\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                `💰 Confirmed: ${formatDogeUsd(balanceInfo.confirmed, priceService.dogeToUsd(balanceInfo.confirmed))}\n`;
            if (balanceInfo.unconfirmed > 0) {
                text += `⏳ Pending: +${formatDogeUsd(balanceInfo.unconfirmed, priceService.dogeToUsd(balanceInfo.unconfirmed))}\n`;
            }
            text +=
                `📊 UTXOs: ${balanceInfo.utxoCount}\n` +
                    `📤 Daily: ${formatDoge(dailySpent)} / ${formatDoge(dailyMax)} DOGE\n` +
                    `${lockStatus}${frozen ? " 🧊 FROZEN" : ""}\n` +
                    `📍 ${balanceInfo.address}\n` +
                    `🔄 Refreshed: ${lastRefreshed}\n` +
                    "\nMuch balance. Very DOGE. Wow. 🐕";
            return { text };
        }
        // ------------------------------------------------------------------
        // Subcommand handler: send
        // ------------------------------------------------------------------
        async function handleWalletSend(args) {
            if (!args) {
                return {
                    text: "🐕 Send DOGE\n" +
                        "━━━━━━━━━━━━\n" +
                        "Usage: /wallet send <amount> to <address>\n" +
                        "  /wallet send 50 DOGE to DReci…pient\n" +
                        "  /wallet send DReci…pient 50",
                };
            }
            // Parse: "<amount> [DOGE] [to] <address>" or "<address> <amount> [DOGE]"
            let amountDoge = null;
            let toAddress = null;
            const match1 = args.match(/^([\d.]+)\s*(?:DOGE\s+)?(?:to\s+)?([A-Za-z1-9]{25,45})$/i);
            const match2 = args.match(/^([A-Za-z1-9]{25,45})\s+([\d.]+)\s*(?:DOGE)?$/i);
            if (match1) {
                amountDoge = parseFloat(match1[1]);
                toAddress = match1[2];
            }
            else if (match2) {
                toAddress = match2[1];
                amountDoge = parseFloat(match2[2]);
            }
            const MAX_DOGE = 10_000_000_000; // 10 billion — above max supply
            if (!amountDoge || !toAddress || isNaN(amountDoge) || amountDoge <= 0 || amountDoge > MAX_DOGE || !isFinite(amountDoge)) {
                return {
                    text: "🐕 Send DOGE\n" +
                        "━━━━━━━━━━━━\n" +
                        "⚠️ Could not parse amount and address.\n" +
                        "Usage: /wallet send <amount> to <address>",
                };
            }
            if (!isValidAddress(toAddress, cfg.network)) {
                return {
                    text: `🐕 ⚠️ Invalid ${cfg.network} address: ${toAddress}\nDouble-check and try again.`,
                };
            }
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet configured. Run /wallet init first." };
            }
            if (!walletManager.isUnlocked()) {
                return { text: "🐕 🔒 Wallet is locked. Run /wallet unlock <passphrase> first." };
            }
            // Evaluate spending policy
            const evaluation = policyEngine.evaluate(amountDoge, toAddress, "Manual send via /wallet send");
            await auditLog.logPolicyCheck(dogeToKoinu(amountDoge), evaluation.tier, evaluation.action, evaluation.reason);
            if (evaluation.action === "deny") {
                // Notify on policy block
                notifier.notifyPolicyBlock(evaluation.reason ?? "Unknown reason").catch(() => { });
                return {
                    text: "🐕 Send DENIED\n" +
                        "━━━━━━━━━━━━━━\n" +
                        `❌ ${evaluation.reason}\n` +
                        `Tier: ${evaluation.tier} | ${formatDogeUsd(amountDoge, priceService.dogeToUsd(amountDoge))}`,
                };
            }
            // Auto-approved tiers: execute immediately
            if (evaluation.allowed) {
                try {
                    const result = await executeSend(toAddress, amountDoge, "Manual send via /wallet send", evaluation.tier);
                    return {
                        text: "🐕 Sending DOGE…\n" +
                            "━━━━━━━━━━━━━━━━\n" +
                            `📤 To: ${truncAddr(toAddress)}\n` +
                            `💰 Amount: ${formatDogeUsd(amountDoge, priceService.dogeToUsd(amountDoge))}\n` +
                            `⛽ Fee: ${formatDoge(result.feeDoge)} DOGE\n` +
                            `📝 Tier: ${evaluation.tier}\n\n` +
                            `✅ Transaction broadcast!\n` +
                            `🔗 TX: ${result.txid}\n` +
                            `⏱️ Est. confirm: ~1 min\n\n` +
                            "Much send. Very crypto. Wow. 🐕",
                    };
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    return {
                        text: `🐕 Send FAILED\n━━━━━━━━━━━━━━\n❌ ${errMsg}\n\nMuch error. Very sad. 🐕`,
                    };
                }
            }
            // Needs approval: queue and notify
            const pending = approvalQueue.queueForApproval({
                to: toAddress,
                amount: dogeToKoinu(amountDoge),
                amountDoge,
                reason: "Manual send via /wallet send",
                tier: evaluation.tier,
                action: evaluation.action,
                delayMinutes: evaluation.delayMinutes,
            });
            // Notify about the approval needed
            notifier.notifyApprovalNeeded({
                id: pending.id,
                amountDoge,
                to: toAddress,
                tier: evaluation.tier,
                reason: "Manual send via /wallet send",
                usdValue: priceService.dogeToUsd(amountDoge),
            }).catch(() => { });
            const shortId = pending.id.slice(0, 8);
            let text = "🐕 Approval Required\n" +
                "━━━━━━━━━━━━━━━━━━━━\n" +
                `📤 To: ${truncAddr(toAddress)}\n` +
                `💰 Amount: ${formatDogeUsd(amountDoge, priceService.dogeToUsd(amountDoge))}\n` +
                `📝 Tier: ${evaluation.tier}\n` +
                `🆔 ID: ${shortId}…\n\n`;
            if (evaluation.action === "delay") {
                text +=
                    `⏰ Auto-approves in ${evaluation.delayMinutes ?? 5} min unless denied.\n` +
                        `Use /wallet deny ${shortId} to cancel.\n`;
            }
            else {
                text += `Use /wallet approve ${shortId} or /wallet deny ${shortId}.\n`;
            }
            text += `\n${evaluation.reason ?? ""}`;
            return { text };
        }
        // ------------------------------------------------------------------
        // Subcommand handler: approve
        // ------------------------------------------------------------------
        async function handleWalletApprove(args, callerId) {
            // SECURITY [L-3]: Owner allowlist check
            if (cfg.ownerChatIds?.length && !cfg.ownerChatIds.includes(callerId)) {
                return { text: "🐕 ⛔ Unauthorized — only wallet owners can approve sends." };
            }
            const idPrefix = args.trim();
            if (!idPrefix) {
                return { text: "🐕 Usage: /wallet approve <id>\nSee /wallet pending for pending approvals." };
            }
            const allPending = approvalQueue.getPending();
            const match = allPending.find((p) => p.id.startsWith(idPrefix));
            if (!match) {
                return { text: `🐕 No pending approval matching "${idPrefix}". See /wallet pending.` };
            }
            // SECURITY [H-3]: Pass actual caller identity for verification
            const approved = approvalQueue.approve(match.id, callerId);
            if (!approved) {
                return { text: "🐕 Approval denied — unauthorized or already resolved." };
            }
            await auditLog.logApproval(match.id, true, callerId, match.amount, match.to);
            try {
                const result = await executeSend(match.to, match.amountDoge, match.reason, match.tier);
                approvalQueue.markExecuted(match.id);
                return {
                    text: "🐕 Approved & Sent!\n" +
                        "━━━━━━━━━━━━━━━━━━\n" +
                        `📤 To: ${truncAddr(match.to)}\n` +
                        `💰 ${formatDogeUsd(match.amountDoge, priceService.dogeToUsd(match.amountDoge))}\n` +
                        `⛽ Fee: ${formatDoge(result.feeDoge)} DOGE\n` +
                        `🔗 TX: ${result.txid}\n\n` +
                        "✅ Broadcast! Much approve. Wow. 🐕",
                };
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                return {
                    text: `🐕 Approved but Send Failed\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `✅ ${match.id.slice(0, 8)} approved.\n` +
                        `❌ Send failed: ${errMsg}`,
                };
            }
        }
        // ------------------------------------------------------------------
        // Subcommand handler: deny
        // ------------------------------------------------------------------
        async function handleWalletDeny(args, callerId) {
            // SECURITY [L-3]: Owner allowlist check
            if (cfg.ownerChatIds?.length && !cfg.ownerChatIds.includes(callerId)) {
                return { text: "🐕 ⛔ Unauthorized — only wallet owners can deny sends." };
            }
            const idPrefix = args.trim();
            if (!idPrefix) {
                return { text: "🐕 Usage: /wallet deny <id>\nSee /wallet pending for pending approvals." };
            }
            const allPending = approvalQueue.getPending();
            const match = allPending.find((p) => p.id.startsWith(idPrefix));
            if (!match) {
                return { text: `🐕 No pending approval matching "${idPrefix}". See /wallet pending.` };
            }
            // SECURITY [H-3]: Pass actual caller identity for verification
            const denied = approvalQueue.deny(match.id, callerId);
            if (!denied) {
                return { text: "🐕 Denial rejected — unauthorized or already resolved." };
            }
            await auditLog.logApproval(match.id, false, callerId, match.amount, match.to);
            return {
                text: "🐕 Send Denied\n" +
                    "━━━━━━━━━━━━━━\n" +
                    `❌ ${formatDogeUsd(match.amountDoge, priceService.dogeToUsd(match.amountDoge))} → ${truncAddr(match.to)}\n` +
                    `🆔 ${match.id.slice(0, 8)}…\n\n` +
                    "Much deny. Very safe. Wow. 🐕",
            };
        }
        // ------------------------------------------------------------------
        // Command: /wallet — Dashboard + subcommands (with onboarding)
        // ------------------------------------------------------------------
        api.registerCommand({
            name: "wallet",
            description: "🐕 Wallet dashboard & management — /wallet [subcommand]",
            acceptsArgs: true,
            handler: async (ctx) => {
                const args = ctx.args?.trim() ?? "";
                const chatId = ctx.chatId ?? ctx.chat?.id ?? "unknown";
                const messageId = ctx.messageId ?? ctx.message?.message_id?.toString();
                // Check if wallet is initialized
                const initialized = await walletManager.isInitialized();
                // If no wallet and no specific subcommand (or just "status"), start onboarding
                if (!initialized && (!args || args.toLowerCase() === "status")) {
                    const flowResult = await onboardingFlow.startOrResume(chatId);
                    return formatOnboardingResult(flowResult);
                }
                if (!args || args.toLowerCase() === "status") {
                    return await handleWalletDashboard();
                }
                const parts = args.split(/\s+/);
                const subCmd = parts[0].toLowerCase();
                const subArgs = parts.slice(1).join(" ");
                switch (subCmd) {
                    case "help": return handleWalletHelp();
                    case "balance": return await handleWalletBalance();
                    case "send": return await handleWalletSend(subArgs);
                    case "approve": return await handleWalletApprove(subArgs, chatId);
                    case "deny": return await handleWalletDeny(subArgs, chatId);
                    case "init": return await handleWalletInit(subArgs);
                    case "recover": {
                        // SECURITY: Auto-delete message that may contain mnemonic
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log).catch(() => { });
                        return await handleWalletRecover(subArgs);
                    }
                    case "address": return await handleWalletAddress();
                    case "lock": return handleWalletLock();
                    case "unlock": {
                        // SECURITY: Auto-delete message containing passphrase
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log).catch(() => { });
                        return await handleWalletUnlock(subArgs);
                    }
                    case "utxos": return await handleWalletUtxos();
                    case "pending": return handleWalletPending();
                    case "history": return await handleWalletHistory();
                    case "freeze": return await handleWalletFreeze();
                    case "unfreeze": return await handleWalletUnfreeze();
                    case "export": {
                        // SECURITY: Auto-delete message that may contain passphrase
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log).catch(() => { });
                        return await handleWalletExport(subArgs);
                    }
                    case "invoice": return await handleWalletInvoice(subArgs);
                    case "invoices": return await handleWalletInvoices();
                    default:
                        return {
                            text: `🐕 Unknown command: "${subCmd}"\n` +
                                "Try /wallet help for available commands.",
                        };
                }
            },
        });
        // ------------------------------------------------------------------
        // Helper: Format onboarding flow result for Telegram
        // ------------------------------------------------------------------
        function formatOnboardingResult(flowResult) {
            const result = {
                text: flowResult.text,
            };
            if (flowResult.keyboard) {
                result.replyMarkup = {
                    inline_keyboard: flowResult.keyboard,
                };
            }
            if (flowResult.parseMode) {
                result.parseMode = flowResult.parseMode;
            }
            return result;
        }
        // ------------------------------------------------------------------
        // Callback Handler: Onboarding inline buttons
        // ------------------------------------------------------------------
        api.registerCallbackHandler?.({
            pattern: /^doge:onboard:/,
            handler: async (ctx) => {
                const chatId = ctx.chatId ?? ctx.chat?.id ?? "unknown";
                const callbackData = ctx.callbackData ?? ctx.data;
                const flowResult = await onboardingFlow.handleCallback({
                    chatId,
                    callbackData,
                });
                if (!flowResult) {
                    return { text: "Unknown action." };
                }
                // SECURITY: Auto-delete the bot's mnemonic message when user confirms backup.
                // On Telegram callback queries, ctx.message.message_id is the message containing
                // the inline button — which is the mnemonic display message itself.
                if (flowResult.deleteBotMessageId) {
                    deleteUserMessage(chatId, flowResult.deleteBotMessageId, log).catch(() => {
                        log("warn", "doge-wallet: failed to auto-delete mnemonic message — user should delete manually");
                    });
                }
                else if (callbackData === "doge:onboard:phrase_saved") {
                    // Fallback: delete the message that contained the "I've Written It Down" button
                    const btnMsgId = ctx.message?.message_id?.toString();
                    if (btnMsgId) {
                        deleteUserMessage(chatId, btnMsgId, log).catch(() => {
                            log("warn", "doge-wallet: failed to auto-delete mnemonic message — user should delete manually");
                        });
                    }
                }
                return formatOnboardingResult(flowResult);
            },
        });
        // ------------------------------------------------------------------
        // Callback Handler: Low Balance Alert buttons
        // ------------------------------------------------------------------
        api.registerCallbackHandler?.({
            pattern: /^doge:lowbal:/,
            handler: async (ctx) => {
                const callbackData = ctx.callbackData ?? ctx.data ?? "";
                // Get current balance for state tracking
                const balance = utxoManager.getBalance();
                const totalDoge = koinuToDoge(balance.confirmed + balance.unconfirmed);
                const threshold = cfg.notifications.lowBalanceAlert;
                if (callbackData === LOW_BALANCE_CALLBACKS.DISMISS) {
                    await alertState.dismiss(totalDoge, threshold);
                    return {
                        text: "✅ Low balance alert dismissed.\nYou'll be notified again if your balance recovers then drops below threshold.",
                    };
                }
                // Handle dynamic snooze: doge:lowbal:snooze:<hours>
                if (callbackData.startsWith(LOW_BALANCE_CALLBACKS.SNOOZE + ':')) {
                    const hoursStr = callbackData.split(':').pop() ?? "0";
                    const hours = parseInt(hoursStr, 10);
                    if (!isNaN(hours) && hours > 0) {
                        const durationMs = hours * 60 * 60 * 1000;
                        await alertState.snooze(durationMs, totalDoge);
                        const label = hours >= 24 ? `${Math.round(hours / 24)} day(s)` : `${hours} hour(s)`;
                        return {
                            text: `💤 Low balance alert snoozed for ${label}.`,
                        };
                    }
                }
                return { text: "Unknown action." };
            },
        });
        // ------------------------------------------------------------------
        // Message Handler: Onboarding text input (passphrase, verification)
        // ------------------------------------------------------------------
        api.registerMessageHandler?.({
            pattern: /./,
            priority: 100, // High priority to intercept during onboarding
            handler: async (ctx) => {
                const chatId = ctx.chatId ?? ctx.chat?.id ?? "unknown";
                const text = ctx.text ?? ctx.message?.text ?? "";
                const messageId = ctx.messageId ?? ctx.message?.message_id?.toString();
                // Check if user is in onboarding flow
                const isOnboarding = await onboardingFlow.isOnboarding(chatId);
                if (!isOnboarding) {
                    // Not in onboarding — let other handlers process
                    return null;
                }
                // Handle onboarding text input
                const flowResult = await onboardingFlow.handleMessage({
                    chatId,
                    text,
                    messageId,
                });
                if (!flowResult) {
                    // No action needed — let other handlers process
                    return null;
                }
                // Delete the user's message if requested (passphrase security)
                if (flowResult.deleteMessageId && messageId) {
                    deleteUserMessage(chatId, messageId, log).catch(() => { });
                }
                return formatOnboardingResult(flowResult);
            },
        });
        // ------------------------------------------------------------------
        // Wallet Sub-command Handlers
        // ------------------------------------------------------------------
        async function handleWalletDashboard() {
            const dashData = await buildDashboardData();
            if (dashData.status === "not-initialized") {
                return {
                    text: formatDashboard(dashData) +
                        "\n\n📋 Get started:\n" +
                        "  /wallet init <passphrase>\n" +
                        "  /wallet recover <mnemonic> | <passphrase>",
                };
            }
            return { text: formatDashboard(dashData) };
        }
        async function handleWalletInit(passphrase) {
            if (!passphrase) {
                return {
                    text: "🐕 Wallet Init\n━━━━━━━━━━━━━━\n" +
                        "Usage: /wallet init <passphrase>\n\n" +
                        "The passphrase encrypts your keys at rest.\n" +
                        "Choose something strong (8+ chars).",
                };
            }
            if (passphrase.length < 8) {
                return {
                    text: "🐕 ⚠️ Passphrase too short — minimum 8 characters.",
                };
            }
            try {
                const result = await walletManager.init(passphrase);
                await auditLog.logAudit({
                    action: "address_generated",
                    address: result.address,
                    reason: "Wallet initialized — new HD wallet created",
                    initiatedBy: "owner",
                });
                startUtxoRefresh();
                startReceiveMonitor(result.address);
                // Update A2A components with new address
                invoiceManager.updateAddress(result.address);
                paymentVerifier.updateAddress(result.address);
                return {
                    text: "🐕 Wallet Initialized!\n━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "⚠️⚠️⚠️ BACKUP YOUR MNEMONIC NOW ⚠️⚠️⚠️\n" +
                        "Write it down physically. Do NOT screenshot.\n" +
                        "This is the ONLY time it will be shown.\n\n" +
                        `🔑 Mnemonic:\n\`${result.mnemonic}\`\n\n` +
                        "━━━━━━━━━━━━━━━━━━━━━━\n" +
                        `📍 Address: ${result.address}\n` +
                        `🌐 Network: ${cfg.network}\n` +
                        "🔓 Status: Unlocked\n\n" +
                        "Much wallet. Very crypto. Wow. 🐕",
                };
            }
            catch (err) {
                if (err instanceof WalletAlreadyInitializedError) {
                    return { text: "🐕 ⚠️ Wallet already exists. Use /wallet recover to restore from mnemonic." };
                }
                log("error", `doge-wallet: init failed: ${err.message}`);
                return { text: "🐕 ❌ Wallet initialization failed. Check logs." };
            }
        }
        async function handleWalletRecover(args) {
            if (!args) {
                return {
                    text: "🐕 Wallet Recover\n━━━━━━━━━━━━━━━━━\n" +
                        "Usage: /wallet recover <24-word mnemonic> | <passphrase>\n\n" +
                        "Separate mnemonic and passphrase with a pipe (|).",
                };
            }
            const pipeIdx = args.lastIndexOf("|");
            if (pipeIdx === -1) {
                return { text: "🐕 ⚠️ Separate mnemonic and passphrase with a pipe (|)." };
            }
            const mnemonic = args.substring(0, pipeIdx).trim();
            const passphrase = args.substring(pipeIdx + 1).trim();
            if (!mnemonic) {
                return { text: "🐕 ⚠️ No mnemonic provided. Need 24 words." };
            }
            if (!passphrase || passphrase.length < 8) {
                return { text: "🐕 ⚠️ Passphrase must be at least 8 characters." };
            }
            try {
                const result = await walletManager.recover(mnemonic, passphrase);
                await auditLog.logAudit({
                    action: "address_generated",
                    address: result.address,
                    reason: "Wallet recovered from mnemonic",
                    initiatedBy: "owner",
                });
                utxoManager.clear();
                startUtxoRefresh();
                startReceiveMonitor(result.address);
                // Update A2A components with recovered address
                invoiceManager.updateAddress(result.address);
                paymentVerifier.updateAddress(result.address);
                return {
                    text: "🐕 Wallet Recovered!\n━━━━━━━━━━━━━━━━━━━━\n" +
                        `📍 Address: ${result.address}\n` +
                        `🌐 Network: ${cfg.network}\n` +
                        "🔓 Status: Unlocked\n\n" +
                        "Much recover. Very restore. Wow. 🐕",
                };
            }
            catch (err) {
                if (err instanceof InvalidMnemonicError) {
                    return { text: "🐕 ❌ Invalid mnemonic. Must be a valid 24-word BIP39 phrase." };
                }
                log("error", `doge-wallet: recover failed: ${err.message}`);
                return { text: "🐕 ❌ Recovery failed. Check logs." };
            }
        }
        async function handleWalletAddress() {
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet configured. Run /wallet init first." };
            }
            const address = await walletManager.getAddress();
            return { text: address };
        }
        function handleWalletLock() {
            if (!walletManager.isUnlocked()) {
                return { text: "🐕 Wallet already locked. Much secure. 🔒" };
            }
            walletManager.lock();
            return {
                text: "🐕 Wallet Locked 🔒\n━━━━━━━━━━━━━━━━━━━\n" +
                    "Private key cleared from memory.\n" +
                    "Use /wallet unlock <passphrase> to unlock.",
            };
        }
        async function handleWalletUnlock(passphrase) {
            if (!passphrase) {
                return { text: "🐕 Usage: /wallet unlock <passphrase>" };
            }
            if (walletManager.isUnlocked()) {
                return { text: "🐕 Wallet already unlocked. 🔓" };
            }
            try {
                await walletManager.unlock(passphrase);
                const address = await walletManager.getAddress();
                // Refresh balance and show detailed info
                if (address) {
                    await utxoManager.refresh(address);
                }
                const balance = utxoManager.getBalance();
                const totalDoge = koinuToDoge(balance.confirmed + balance.unconfirmed);
                const usdValue = priceService.dogeToUsd(totalDoge);
                const utxoCount = utxoManager.getUtxos().length;
                const frozen = policyEngine.isFrozen();
                let text = "🐕 Wallet Unlocked 🔓\n━━━━━━━━━━━━━━━━━━━━━\n" +
                    `📍 ${address}\n` +
                    `💰 Balance: ${formatDogeUsd(totalDoge, usdValue)}\n` +
                    `📊 UTXOs: ${utxoCount}\n` +
                    `🌐 Network: ${cfg.network}`;
                if (frozen) {
                    text += "\n🧊 Status: FROZEN";
                }
                text += "\n\nPrivate key loaded. Much decrypt. Wow. 🐕";
                return { text };
            }
            catch (err) {
                if (err instanceof InvalidPassphraseError) {
                    return { text: "🐕 ❌ Invalid passphrase. Try again." };
                }
                if (err instanceof WalletNotInitializedError) {
                    return { text: "🐕 No wallet to unlock. Run /wallet init first." };
                }
                log("error", `doge-wallet: unlock failed: ${err.message}`);
                return { text: "🐕 ❌ Unlock failed. Check logs." };
            }
        }
        async function handleWalletUtxos() {
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet configured. Run /wallet init first." };
            }
            const utxos = utxoManager.getUtxos();
            const summary = getUtxoSummary(utxos);
            const balance = utxoManager.getBalance();
            const consolidation = shouldConsolidate(utxos);
            const lastRefreshed = utxoManager.getLastRefreshed();
            let text = "🐕 UTXO Details\n━━━━━━━━━━━━━━━━\n" +
                `📊 Total: ${summary.total}\n` +
                `  ✅ Confirmed: ${summary.confirmed}\n` +
                `  ⏳ Unconfirmed: ${summary.unconfirmed}\n` +
                `  🔒 Locked: ${summary.locked}\n` +
                `  🧹 Dust: ${summary.dust}\n\n` +
                "📏 Size Distribution:\n" +
                `  Small (< 1): ${summary.sizes.small}\n` +
                `  Medium (1–100): ${summary.sizes.medium}\n` +
                `  Large (> 100): ${summary.sizes.large}\n\n` +
                `💰 Balance: ${formatDogeUsd(koinuToDoge(balance.total), priceService.dogeToUsd(koinuToDoge(balance.total)))}\n`;
            if (lastRefreshed) {
                text += `🔄 Refreshed: ${formatET(lastRefreshed)}\n`;
            }
            text += "\n";
            if (consolidation.shouldConsolidate) {
                text += `⚠️ Consolidation recommended: ${consolidation.reason}\n`;
                text += `  Est. fee: ${formatDoge(koinuToDoge(consolidation.estimatedFee))} DOGE\n`;
            }
            else {
                text += `✅ ${consolidation.reason}\n`;
            }
            if (utxos.length > 0) {
                text += "\n📋 Largest UTXOs:\n";
                const sorted = [...utxos].sort((a, b) => b.amount - a.amount);
                for (const u of sorted.slice(0, 10)) {
                    const lock = u.locked ? "🔒" : "  ";
                    const conf = u.confirmations >= 1 ? `${u.confirmations}conf` : "unconf";
                    text += `${lock} ${formatDoge(koinuToDoge(u.amount))} DOGE (${conf}) — ${u.txid.slice(0, 12)}…:${u.vout}\n`;
                }
                if (utxos.length > 10)
                    text += `  … and ${utxos.length - 10} more\n`;
            }
            return { text };
        }
        function handleWalletPending() {
            const pending = approvalQueue.getPending();
            if (pending.length === 0) {
                return { text: "🐕 Pending Approvals\n━━━━━━━━━━━━━━━━━━━━\nNone. Much clear. 🐕" };
            }
            let text = "🐕 Pending Approvals\n━━━━━━━━━━━━━━━━━━━━\n";
            for (const p of pending) {
                const expiresIn = Math.max(0, Math.round((new Date(p.expiresAt).getTime() - Date.now()) / 60000));
                text +=
                    `\n🆔 ${p.id.slice(0, 8)}…\n` +
                        `  📤 ${formatDogeUsd(p.amountDoge, priceService.dogeToUsd(p.amountDoge))} → ${truncAddr(p.to)}\n` +
                        `  📝 Tier: ${p.tier} | Auto-${p.autoAction} in ${expiresIn}m\n` +
                        `  📋 ${p.reason}\n`;
            }
            text += "\nUse /wallet approve <id> or /wallet deny <id>.";
            return { text };
        }
        async function handleWalletHistory() {
            const entries = await auditLog.getFullHistory(20);
            if (entries.length === 0) {
                return { text: "🐕 Transaction History\n━━━━━━━━━━━━━━━━━━━━━━\nNo transactions yet. 🐕" };
            }
            let text = "🐕 Transaction History\n━━━━━━━━━━━━━━━━━━━━━━\n";
            for (const e of entries.slice(0, 15)) {
                const amountDoge = e.amount ? koinuToDoge(e.amount) : 0;
                const ts = formatET(e.timestamp);
                if (e.action === "receive") {
                    text +=
                        `\n➕ ${formatDoge(amountDoge)} DOGE ← ${truncAddr(e.address ?? "unknown")}\n` +
                            `  ${ts}\n` +
                            `  🔗 ${e.txid?.slice(0, 16) ?? "?"}…\n`;
                }
                else {
                    const feeDoge = e.fee ? koinuToDoge(e.fee) : 0;
                    text +=
                        `\n➖ ${formatDoge(amountDoge)} DOGE → ${truncAddr(e.address ?? "unknown")}\n` +
                            `  ⛽ ${formatDoge(feeDoge)} fee | ${e.tier ?? "?"} | ${ts}\n` +
                            `  🔗 ${e.txid?.slice(0, 16) ?? "?"}…\n`;
                }
            }
            if (entries.length > 15)
                text += `\n… and ${entries.length - 15} more.`;
            return { text };
        }
        async function handleWalletFreeze() {
            policyEngine.freeze();
            await saveFreezeState();
            await auditLog.logFreeze(true, "owner");
            notifier.notifyFreeze().catch(() => { });
            return {
                text: "🧊 Wallet FROZEN\n━━━━━━━━━━━━━━━━\n" +
                    "All outbound transactions blocked.\n" +
                    "Use /wallet unfreeze to resume.\n\n" +
                    "Much freeze. Very safe. Wow. 🐕",
            };
        }
        async function handleWalletUnfreeze() {
            policyEngine.unfreeze();
            await saveFreezeState();
            await auditLog.logFreeze(false, "owner");
            notifier.notifyUnfreeze().catch(() => { });
            return {
                text: "🔥 Wallet UNFROZEN\n━━━━━━━━━━━━━━━━━━\n" +
                    "Normal spending policy restored.\n\n" +
                    "Much thaw. Very warm. Wow. 🐕",
            };
        }
        async function handleWalletExport(subArgs) {
            const limitStr = subArgs.trim();
            const limit = limitStr ? parseInt(limitStr, 10) : 50;
            const count = isNaN(limit) ? 50 : Math.min(limit, 500);
            const entries = await auditLog.getAuditLog(count);
            if (entries.length === 0) {
                return { text: "🐕 Wallet Export\n━━━━━━━━━━━━━━━━\nNo audit entries to export." };
            }
            let text = "🐕 Audit Export (last " + entries.length + " entries)\n";
            text += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
            for (const e of entries) {
                const ts = formatET(e.timestamp);
                const amountStr = e.amount ? ` ${formatDoge(koinuToDoge(e.amount))} DOGE` : "";
                const addrStr = e.address ? ` → ${truncAddr(e.address)}` : "";
                const feeStr = e.fee ? ` (fee ${formatDoge(koinuToDoge(e.fee))})` : "";
                const txStr = e.txid ? ` [${e.txid.slice(0, 12)}…]` : "";
                text += `${ts} | ${e.action}${amountStr}${addrStr}${feeStr}${txStr}\n`;
                if (e.reason)
                    text += `  📋 ${e.reason}\n`;
            }
            return { text };
        }
        function handleWalletHelp() {
            return {
                text: "🐕 DOGE Wallet Commands\n" +
                    "━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                    "📊 Info:\n" +
                    "  /wallet — Dashboard overview\n" +
                    "  /wallet balance — Check wallet balance\n" +
                    "  /wallet address — Show receiving address\n" +
                    "  /wallet utxos — UTXO details\n" +
                    "  /wallet history — Recent transactions\n" +
                    "  /wallet export [N] — Export audit trail (last N entries)\n\n" +
                    "💸 Sending:\n" +
                    "  /wallet send <amount> to <address> — Send DOGE\n" +
                    "  /wallet approve <id> — Approve pending send\n" +
                    "  /wallet deny <id> — Deny pending send\n" +
                    "  /wallet pending — Show pending approvals\n\n" +
                    "🧾 Invoices (A2A):\n" +
                    "  /wallet invoice <amount> <description> — Create invoice\n" +
                    "  /wallet invoices — List recent invoices\n\n" +
                    "🔐 Security:\n" +
                    "  /wallet init <passphrase> — Create new wallet\n" +
                    "  /wallet recover <mnemonic> | <passphrase> — Restore\n" +
                    "  /wallet unlock <passphrase> — Unlock wallet\n" +
                    "  /wallet lock — Lock wallet\n" +
                    "  /wallet freeze — Emergency freeze all sends\n" +
                    "  /wallet unfreeze — Resume sends\n\n" +
                    "Much command. Very help. Wow. 🐕",
            };
        }
        // ------------------------------------------------------------------
        // A2A Invoice Handlers (Phase 5)
        // ------------------------------------------------------------------
        async function handleWalletInvoice(args) {
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet configured. Run /wallet init first." };
            }
            if (!args) {
                return {
                    text: "🐕 Create Invoice\n━━━━━━━━━━━━━━━━━\n" +
                        "Usage: /wallet invoice <amount> <description>\n\n" +
                        "Example: /wallet invoice 50 Payment for data analysis\n\n" +
                        "Creates an A2A invoice for receiving DOGE.",
                };
            }
            // Parse: <amount> <description>
            const match = args.match(/^([\d.]+)\s+(.+)$/);
            if (!match) {
                return {
                    text: "🐕 ⚠️ Could not parse invoice.\nUsage: /wallet invoice <amount> <description>",
                };
            }
            const amount = parseFloat(match[1]);
            const description = match[2].trim();
            if (isNaN(amount) || amount <= 0) {
                return { text: "🐕 ⚠️ Amount must be a positive number." };
            }
            if (!description || description.length < 3) {
                return { text: "🐕 ⚠️ Description is required (at least 3 characters)." };
            }
            try {
                const invoice = invoiceManager.createInvoice(amount, description);
                // Log to audit trail
                await auditLog.logAudit({
                    action: "invoice_created",
                    amount: dogeToKoinu(amount),
                    reason: `Invoice ${invoice.invoiceId.slice(0, 8)}… created: ${description}`,
                    initiatedBy: "owner",
                    metadata: { invoiceId: invoice.invoiceId, description },
                });
                const usd = priceService.dogeToUsd(amount);
                const expiresIn = Math.round((new Date(invoice.expiresAt).getTime() - Date.now()) / 60000);
                return {
                    text: "🐕 Invoice Created!\n" +
                        "━━━━━━━━━━━━━━━━━━\n" +
                        `🧾 ID: ${invoice.invoiceId.slice(0, 8)}…\n` +
                        `💰 Amount: ${formatDogeUsd(amount, usd)}\n` +
                        `📝 ${description}\n` +
                        `📍 Pay to: ${invoice.payee.address}\n` +
                        `⏰ Expires in: ${expiresIn} minutes\n\n` +
                        `OP_RETURN: ${OP_RETURN_PREFIX}${invoice.invoiceId}\n\n` +
                        "Share this with the paying agent. Much invoice. Wow. 🐕",
                };
            }
            catch (err) {
                return { text: `🐕 ❌ Invoice creation failed: ${err.message}` };
            }
        }
        async function handleWalletInvoices() {
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet configured. Run /wallet init first." };
            }
            const invoices = invoiceManager.listInvoices({ limit: 10 });
            const stats = invoiceManager.getStats();
            if (invoices.length === 0) {
                return {
                    text: "🐕 Invoices\n━━━━━━━━━━━\n" +
                        "No invoices yet.\n\n" +
                        "Create one with: /wallet invoice <amount> <description>",
                };
            }
            let text = "🐕 Recent Invoices\n" +
                "━━━━━━━━━━━━━━━━━━━\n" +
                `📊 Total: ${stats.total} | Pending: ${stats.pending} | Paid: ${stats.paid}\n\n`;
            for (const inv of invoices) {
                const shortId = inv.invoiceId.slice(0, 8);
                const statusEmoji = inv.status === "paid" ? "✅" :
                    inv.status === "pending" ? "⏳" :
                        inv.status === "expired" ? "⏰" : "❌";
                const created = formatET(inv.createdAt);
                text += `${statusEmoji} ${shortId}… | ${formatDoge(inv.payment.amount)} DOGE | ${inv.status}\n`;
                text += `   📝 ${inv.payment.description.slice(0, 40)}${inv.payment.description.length > 40 ? "…" : ""}\n`;
                text += `   📅 ${created}\n`;
                if (inv.txid) {
                    text += `   🔗 ${inv.txid.slice(0, 12)}…\n`;
                }
                text += "\n";
            }
            return { text };
        }
        // ------------------------------------------------------------------
        // UTXO Refresh Lifecycle
        // ------------------------------------------------------------------
        function startUtxoRefresh() {
            if (utxoRefreshTimer) {
                clearInterval(utxoRefreshTimer);
                utxoRefreshTimer = null;
            }
            doUtxoRefresh().catch((err) => {
                log("warn", `doge-wallet: initial UTXO refresh failed: ${err.message ?? err}`);
            });
            utxoRefreshTimer = setInterval(() => {
                doUtxoRefresh().catch((err) => {
                    log("warn", `doge-wallet: UTXO refresh failed: ${err.message ?? err}`);
                });
            }, refreshIntervalMs);
            if (utxoRefreshTimer && typeof utxoRefreshTimer.unref === "function") {
                utxoRefreshTimer.unref();
            }
            log("info", `doge-wallet: UTXO refresh started (every ${cfg.utxo.refreshIntervalSeconds}s)`);
        }
        function stopUtxoRefresh() {
            if (utxoRefreshTimer) {
                clearInterval(utxoRefreshTimer);
                utxoRefreshTimer = null;
            }
        }
        // ------------------------------------------------------------------
        // Receive Monitor Lifecycle
        // ------------------------------------------------------------------
        function startReceiveMonitor(address) {
            receiveMonitor.setAddress(address);
            receiveMonitor.start();
        }
        // ------------------------------------------------------------------
        // Approval Expiry Timer
        // ------------------------------------------------------------------
        function startApprovalExpiryCheck() {
            approvalExpiryTimer = setInterval(async () => {
                const autoApproved = approvalQueue.expire();
                for (const entry of autoApproved) {
                    try {
                        log("info", `doge-wallet: auto-executing approved send ${entry.id}`);
                        const result = await executeSend(entry.to, entry.amountDoge, entry.reason, entry.tier);
                        approvalQueue.markExecuted(entry.id);
                        log("info", `doge-wallet: auto-approved send ${entry.id} executed: txid=${result.txid}`);
                    }
                    catch (err) {
                        log("error", `doge-wallet: auto-approved send ${entry.id} failed: ${err.message}`);
                        notifier.notifyError(`Auto-approved send failed: ${err.message}`).catch(() => { });
                    }
                }
                approvalQueue.cleanup();
            }, 30_000);
            if (approvalExpiryTimer && typeof approvalExpiryTimer.unref === "function") {
                approvalExpiryTimer.unref();
            }
        }
        function stopApprovalExpiryCheck() {
            if (approvalExpiryTimer) {
                clearInterval(approvalExpiryTimer);
                approvalExpiryTimer = null;
            }
        }
        // Invoice cleanup timer — expire stale invoices every 5 min
        let invoiceCleanupTimer = null;
        function startInvoiceCleanup() {
            invoiceCleanupTimer = setInterval(() => {
                invoiceManager.cleanupExpired().catch(() => { });
            }, 300_000); // 5 minutes
            if (invoiceCleanupTimer && typeof invoiceCleanupTimer.unref === "function") {
                invoiceCleanupTimer.unref();
            }
        }
        function stopInvoiceCleanup() {
            if (invoiceCleanupTimer) {
                clearInterval(invoiceCleanupTimer);
                invoiceCleanupTimer = null;
            }
        }
        // ------------------------------------------------------------------
        // Tool: wallet_balance
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_balance",
            label: "DOGE Wallet Balance",
            description: "Check the current DOGE wallet balance. Returns confirmed/unconfirmed amounts, " +
                "USD value, UTXO count, and current receiving address.",
            parameters: Type.Object({}),
            async execute() {
                const initialized = await walletManager.isInitialized();
                if (!initialized) {
                    return {
                        content: [{ type: "text", text: "No wallet configured. Run /wallet init first." }],
                        details: { initialized: false, status: "not_initialized" },
                    };
                }
                const balanceInfo = await getBalanceInfo();
                if (!balanceInfo) {
                    return {
                        content: [{ type: "text", text: "Failed to retrieve balance." }],
                        details: { error: "BALANCE_UNAVAILABLE" },
                    };
                }
                const unlocked = walletManager.isUnlocked();
                const frozen = policyEngine.isFrozen();
                return {
                    content: [
                        {
                            type: "text",
                            text: `DOGE balance: ${formatDoge(balanceInfo.confirmed)} confirmed, ` +
                                `${formatDoge(balanceInfo.unconfirmed)} pending. ` +
                                `Total: ${formatDogeUsd(balanceInfo.total, balanceInfo.usd)}. ` +
                                `${balanceInfo.utxoCount} UTXOs. Address: ${balanceInfo.address}. ` +
                                `${unlocked ? "Unlocked" : "Locked"}${frozen ? " FROZEN" : ""}.`,
                        },
                    ],
                    details: {
                        initialized: true,
                        unlocked,
                        frozen,
                        confirmed: balanceInfo.confirmed,
                        unconfirmed: balanceInfo.unconfirmed,
                        total: balanceInfo.total,
                        usd: balanceInfo.usd,
                        address: balanceInfo.address,
                        utxoCount: balanceInfo.utxoCount,
                        lastRefreshed: balanceInfo.lastRefreshed,
                        network: cfg.network,
                    },
                };
            },
        }, { name: "wallet_balance" });
        // ------------------------------------------------------------------
        // Tool: wallet_send
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_send",
            label: "Send DOGE",
            description: "Send DOGE to an address. Subject to spending policy tiers. " +
                "Returns txid on success or pending approval ID.",
            parameters: Type.Object({
                to: Type.String({ description: "Recipient DOGE address" }),
                amount: Type.Number({ description: "Amount in DOGE" }),
                currency: Type.Optional(Type.String({ description: "Currency (DOGE)", default: "DOGE" })),
                reason: Type.String({ description: "Why this payment is being made (audit)" }),
            }),
            async execute(_toolCallId, params) {
                // Phase 6: Rate limiting
                const rateCheck = rateLimiter.consume("send:execute");
                if (!rateCheck.allowed) {
                    return {
                        content: [{ type: "text", text: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetInMs / 1000)}s.` }],
                        details: { error: "RATE_LIMITED", resetInMs: rateCheck.resetInMs },
                    };
                }
                // Phase 6: Sanitize address input
                const addressResult = validateAddress(params.to, cfg.network);
                if (!addressResult.valid) {
                    return {
                        content: [{ type: "text", text: addressResult.error ?? `Invalid ${cfg.network} address` }],
                        details: { error: "INVALID_ADDRESS" },
                    };
                }
                const sanitizedAddress = addressResult.value;
                // Phase 6: Validate amount
                const amountResult = validateAmount(params.amount, {
                    network: cfg.network,
                    warnThreshold: cfg.network === "mainnet" ? 1000 : undefined,
                });
                if (!amountResult.valid) {
                    return {
                        content: [{ type: "text", text: amountResult.error ?? "Invalid amount" }],
                        details: { error: "INVALID_AMOUNT" },
                    };
                }
                const sanitizedAmount = amountResult.value;
                // Phase 6: Sanitize reason
                const reasonResult = sanitizeDescription(params.reason);
                const sanitizedReason = reasonResult.valid ? reasonResult.value : "No reason provided";
                // Legacy address check (kept for backward compatibility, but already validated above)
                if (!isValidAddress(sanitizedAddress, cfg.network)) {
                    return {
                        content: [{ type: "text", text: `Invalid ${cfg.network} address: ${sanitizedAddress}` }],
                        details: { error: "INVALID_ADDRESS" },
                    };
                }
                const initialized = await walletManager.isInitialized();
                if (!initialized) {
                    return {
                        content: [{ type: "text", text: "No wallet configured." }],
                        details: { error: "WALLET_NOT_INITIALIZED" },
                    };
                }
                if (!walletManager.isUnlocked()) {
                    return {
                        content: [{ type: "text", text: "Wallet locked. Unlock first." }],
                        details: { error: "WALLET_LOCKED" },
                    };
                }
                // Use sanitized values from Phase 6 validation
                const evaluation = policyEngine.evaluate(sanitizedAmount, sanitizedAddress, sanitizedReason);
                await auditLog.logPolicyCheck(dogeToKoinu(sanitizedAmount), evaluation.tier, evaluation.action, evaluation.reason);
                if (evaluation.action === "deny") {
                    notifier.notifyPolicyBlock(evaluation.reason ?? "Unknown").catch(() => { });
                    return {
                        content: [{ type: "text", text: `Send denied: ${evaluation.reason}` }],
                        details: { status: "denied", tier: evaluation.tier, reason: evaluation.reason },
                    };
                }
                if (evaluation.allowed) {
                    try {
                        const result = await executeSend(sanitizedAddress, sanitizedAmount, sanitizedReason, evaluation.tier);
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Sent ${formatDogeUsd(sanitizedAmount, priceService.dogeToUsd(sanitizedAmount))} to ${sanitizedAddress}. ` +
                                        `TX: ${result.txid}. Fee: ${formatDoge(result.feeDoge)} DOGE. Tier: ${evaluation.tier}.`,
                                },
                            ],
                            details: {
                                status: "sent",
                                txid: result.txid,
                                fee: result.feeDoge,
                                tier: evaluation.tier,
                            },
                        };
                    }
                    catch (err) {
                        // Phase 6: Sanitize error message to prevent info leakage
                        const safeError = sanitizeErrorMessage(err);
                        return {
                            content: [{ type: "text", text: `Send failed: ${safeError}` }],
                            details: { status: "error", error: safeError },
                        };
                    }
                }
                // Needs approval - use sanitized values
                const pending = approvalQueue.queueForApproval({
                    to: sanitizedAddress,
                    amount: dogeToKoinu(sanitizedAmount),
                    amountDoge: sanitizedAmount,
                    reason: sanitizedReason,
                    tier: evaluation.tier,
                    action: evaluation.action,
                    delayMinutes: evaluation.delayMinutes,
                });
                notifier.notifyApprovalNeeded({
                    id: pending.id,
                    amountDoge: sanitizedAmount,
                    to: sanitizedAddress,
                    tier: evaluation.tier,
                    reason: sanitizedReason,
                    usdValue: priceService.dogeToUsd(sanitizedAmount),
                }).catch(() => { });
                return {
                    content: [
                        {
                            type: "text",
                            text: `Send of ${formatDogeUsd(sanitizedAmount, priceService.dogeToUsd(sanitizedAmount))} to ${sanitizedAddress} needs approval. ` +
                                `ID: ${pending.id.slice(0, 8)}. Tier: ${evaluation.tier}.`,
                        },
                    ],
                    details: {
                        status: "pending-approval",
                        approvalId: pending.id,
                        tier: evaluation.tier,
                        action: evaluation.action,
                    },
                };
            },
        }, { name: "wallet_send" });
        // ------------------------------------------------------------------
        // Tool: wallet_history
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_history",
            label: "DOGE Transaction History",
            description: "Get recent DOGE wallet transaction history.",
            parameters: Type.Object({
                limit: Type.Optional(Type.Number({ description: "Max results (default: 10)", default: 10 })),
            }),
            async execute(_toolCallId, params) {
                const limit = params.limit ?? 10;
                const entries = await auditLog.getFullHistory(limit);
                if (entries.length === 0) {
                    return {
                        content: [{ type: "text", text: "No transaction history yet." }],
                        details: { transactions: [], count: 0 },
                    };
                }
                const transactions = entries.map((e) => ({
                    txid: e.txid,
                    type: e.action === "receive" ? "received" : "sent",
                    amount: e.amount ? koinuToDoge(e.amount) : 0,
                    address: e.address ?? "unknown",
                    fee: e.fee ? koinuToDoge(e.fee) : 0,
                    tier: e.tier,
                    timestamp: e.timestamp,
                    reason: e.reason,
                }));
                const summary = transactions
                    .map((t) => {
                    const icon = t.type === "received" ? "➕" : "➖";
                    const arrow = t.type === "received" ? "←" : "→";
                    return `${icon} ${formatDoge(t.amount)} DOGE ${arrow} ${truncAddr(t.address)} (${formatET(t.timestamp)})`;
                })
                    .join("\n");
                return {
                    content: [{ type: "text", text: `Recent transactions:\n${summary}` }],
                    details: { transactions, count: transactions.length },
                };
            },
        }, { name: "wallet_history" });
        // ------------------------------------------------------------------
        // Tool: wallet_address
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_address",
            label: "DOGE Wallet Address",
            description: "Get the current DOGE receiving address.",
            parameters: Type.Object({
                fresh: Type.Optional(Type.Boolean({ description: "Generate new address (not yet supported)" })),
                label: Type.Optional(Type.String({ description: "Label for the address" })),
            }),
            async execute() {
                const initialized = await walletManager.isInitialized();
                if (!initialized) {
                    return {
                        content: [{ type: "text", text: "No wallet configured." }],
                        details: { initialized: false },
                    };
                }
                const address = await walletManager.getAddress();
                return {
                    content: [{ type: "text", text: `DOGE address: ${address} (${cfg.network})` }],
                    details: { initialized: true, address, network: cfg.network, dogeUri: `dogecoin:${address}` },
                };
            },
        }, { name: "wallet_address" });
        // ------------------------------------------------------------------
        // Tool: wallet_init
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_init",
            label: "Initialize DOGE Wallet",
            description: "Initialize a new DOGE wallet. Generates a BIP39 mnemonic and encrypted keystore. " +
                "The mnemonic is delivered via secure direct message (NOT in tool output). It cannot be retrieved later.",
            parameters: Type.Object({
                passphrase: Type.String({ description: "Encryption passphrase (8+ chars)", minLength: 8 }),
            }),
            async execute(_toolCallId, params) {
                try {
                    const result = await walletManager.init(params.passphrase);
                    await auditLog.logAudit({
                        action: "address_generated",
                        address: result.address,
                        reason: "Wallet initialized via agent tool",
                        initiatedBy: "agent",
                    });
                    startUtxoRefresh();
                    startReceiveMonitor(result.address);
                    // Update A2A components with new address
                    invoiceManager.updateAddress(result.address);
                    paymentVerifier.updateAddress(result.address);
                    // SECURITY: Never return mnemonic in tool result (stored in session history).
                    // Deliver it via direct Telegram message instead.
                    try {
                        await sendNotification(`🔐 DOGE Wallet Recovery Phrase\n━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                            `⚠️ WRITE THIS DOWN NOW. It will NEVER be shown again.\n` +
                            `Do NOT screenshot. Store physically in a safe place.\n\n` +
                            `${result.mnemonic}\n\n` +
                            `━━━━━━━━━━━━━━━━━━━━━━\n` +
                            `Address: ${result.address}\n` +
                            `Network: ${cfg.network}`);
                    }
                    catch (notifyErr) {
                        log("error", `doge-wallet: CRITICAL - failed to deliver mnemonic via notification: ${notifyErr.message}`);
                        // As absolute last resort, include in tool result so user doesn't lose funds
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Wallet initialized! Address: ${result.address}. Network: ${cfg.network}.\n` +
                                        `⚠️ CRITICAL: Secure delivery failed. Save this mnemonic NOW. It will NEVER be shown again.\n` +
                                        `Mnemonic: ${result.mnemonic}`,
                                },
                            ],
                            details: {
                                address: result.address,
                                publicKey: result.publicKey,
                                network: cfg.network,
                                mnemonicProvided: true,
                                deliveryMethod: "tool_result_fallback",
                            },
                        };
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: `✅ Wallet initialized! Address: ${result.address}. Network: ${cfg.network}.\n` +
                                    `🔐 Recovery phrase was sent via secure direct message.\n` +
                                    `⚠️ Write it down physically and delete the message immediately.`,
                            },
                        ],
                        details: {
                            address: result.address,
                            publicKey: result.publicKey,
                            network: cfg.network,
                            mnemonicProvided: false,
                            deliveryMethod: "direct_message",
                        },
                    };
                }
                catch (err) {
                    if (err instanceof WalletAlreadyInitializedError) {
                        const address = await walletManager.getAddress();
                        return {
                            content: [{ type: "text", text: `Wallet already exists at ${address}.` }],
                            details: { error: "WALLET_ALREADY_INITIALIZED", address },
                        };
                    }
                    return {
                        content: [{ type: "text", text: `Init failed: ${err.message}` }],
                        details: { error: err.message },
                    };
                }
            },
        }, { name: "wallet_init" });
        // ------------------------------------------------------------------
        // Tool: wallet_invoice (Phase 5)
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_invoice",
            label: "Create DOGE Invoice",
            description: "Create an A2A invoice for receiving DOGE payments. Returns invoice details " +
                "including the invoice ID for OP_RETURN tagging.",
            parameters: Type.Object({
                amount: Type.Number({ description: "Amount in DOGE" }),
                description: Type.String({ description: "What this payment is for" }),
                reference: Type.Optional(Type.String({ description: "External reference ID" })),
                expiryMinutes: Type.Optional(Type.Number({ description: "Expiry time in minutes (default: 60)" })),
                callbackUrl: Type.Optional(Type.String({ description: "URL to POST when paid" })),
            }),
            async execute(_toolCallId, params) {
                // Phase 6: Rate limiting
                const rateCheck = rateLimiter.consume("invoice:create");
                if (!rateCheck.allowed) {
                    return {
                        content: [{ type: "text", text: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetInMs / 1000)}s.` }],
                        details: { error: "RATE_LIMITED", resetInMs: rateCheck.resetInMs },
                    };
                }
                const initialized = await walletManager.isInitialized();
                if (!initialized) {
                    return {
                        content: [{ type: "text", text: "No wallet configured." }],
                        details: { error: "WALLET_NOT_INITIALIZED" },
                    };
                }
                // Phase 6: Validate amount
                const amountResult = validateAmount(params.amount, { network: cfg.network });
                if (!amountResult.valid) {
                    return {
                        content: [{ type: "text", text: amountResult.error ?? "Invalid amount" }],
                        details: { error: "INVALID_AMOUNT" },
                    };
                }
                const sanitizedAmount = amountResult.value;
                // Phase 6: Sanitize description
                const descResult = sanitizeDescription(params.description);
                if (!descResult.valid) {
                    return {
                        content: [{ type: "text", text: descResult.error ?? "Invalid description" }],
                        details: { error: "INVALID_DESCRIPTION" },
                    };
                }
                const sanitizedDescription = descResult.value;
                // Phase 6: Validate callback URL if provided
                let sanitizedCallbackUrl;
                if (params.callbackUrl) {
                    const urlResult = validateCallbackUrl(params.callbackUrl);
                    if (!urlResult.valid) {
                        return {
                            content: [{ type: "text", text: urlResult.error ?? "Invalid callback URL" }],
                            details: { error: "INVALID_CALLBACK_URL" },
                        };
                    }
                    sanitizedCallbackUrl = urlResult.value;
                }
                try {
                    const expiryMs = (params.expiryMinutes ?? 60) * 60 * 1000;
                    const invoice = invoiceManager.createInvoice(sanitizedAmount, sanitizedDescription, {
                        reference: params.reference,
                        expiryMs,
                        callbackUrl: sanitizedCallbackUrl,
                    });
                    await auditLog.logAudit({
                        action: "invoice_created",
                        amount: dogeToKoinu(sanitizedAmount),
                        reason: `Invoice created: ${sanitizedDescription}`,
                        initiatedBy: "agent",
                        metadata: { invoiceId: invoice.invoiceId },
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Invoice created: ${invoice.invoiceId}. ` +
                                    `Amount: ${formatDoge(sanitizedAmount)} DOGE. ` +
                                    `Pay to: ${invoice.payee.address}. ` +
                                    `OP_RETURN: ${OP_RETURN_PREFIX}${invoice.invoiceId}`,
                            },
                        ],
                        details: {
                            invoice,
                            opReturnData: `${OP_RETURN_PREFIX}${invoice.invoiceId}`,
                        },
                    };
                }
                catch (err) {
                    // Phase 6: Sanitize error message
                    const safeError = sanitizeErrorMessage(err);
                    return {
                        content: [{ type: "text", text: `Invoice creation failed: ${safeError}` }],
                        details: { error: safeError },
                    };
                }
            },
        }, { name: "wallet_invoice" });
        // ------------------------------------------------------------------
        // Tool: wallet_verify_payment (Phase 5)
        // ------------------------------------------------------------------
        api.registerTool({
            name: "wallet_verify_payment",
            label: "Verify DOGE Payment",
            description: "Verify an incoming payment notification against an invoice. " +
                "Checks transaction on-chain, validates amount, and verifies OP_RETURN.",
            parameters: Type.Object({
                invoiceId: Type.String({ description: "Invoice ID to verify against" }),
                txid: Type.String({ description: "Transaction ID of the payment" }),
                amount: Type.Number({ description: "Amount claimed to have been sent (DOGE)" }),
            }),
            async execute(_toolCallId, params) {
                const invoice = invoiceManager.getInvoice(params.invoiceId);
                if (!invoice) {
                    return {
                        content: [{ type: "text", text: `Invoice ${params.invoiceId} not found.` }],
                        details: { error: "INVOICE_NOT_FOUND", invoiceId: params.invoiceId },
                    };
                }
                if (invoice.status !== "pending") {
                    return {
                        content: [{ type: "text", text: `Invoice already ${invoice.status}.` }],
                        details: { error: "INVOICE_NOT_PENDING", status: invoice.status },
                    };
                }
                const notification = {
                    invoiceId: params.invoiceId,
                    txid: params.txid,
                    amount: params.amount,
                    paidAt: new Date().toISOString(),
                };
                try {
                    const result = await paymentVerifier.verifyPayment(notification, invoice);
                    if (result.valid) {
                        // Mark invoice as paid
                        await invoiceManager.markInvoicePaid(params.invoiceId, params.txid);
                        // Log to audit trail
                        await auditLog.logAudit({
                            action: "invoice_paid",
                            txid: params.txid,
                            amount: result.amountReceived,
                            reason: `Invoice ${params.invoiceId.slice(0, 8)}… paid`,
                            initiatedBy: "external",
                            metadata: { invoiceId: params.invoiceId, confirmations: result.confirmations },
                        });
                        // Send callback if configured (fire and forget)
                        if (invoice.callback?.url) {
                            callbackSender
                                .sendPaymentCallback(invoice, params.txid, 0, result.confirmations)
                                .catch((err) => {
                                log("warn", `doge-wallet: callback failed: ${err.message ?? err}`);
                            });
                        }
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Payment verified! Invoice ${params.invoiceId.slice(0, 8)}… is now paid. ` +
                                        `Received: ${koinuToDoge(result.amountReceived)} DOGE. ` +
                                        `Confirmations: ${result.confirmations}.`,
                                },
                            ],
                            details: {
                                valid: true,
                                invoiceId: params.invoiceId,
                                txid: params.txid,
                                amountReceived: koinuToDoge(result.amountReceived),
                                confirmations: result.confirmations,
                                opReturnMatch: result.opReturnMatch,
                            },
                        };
                    }
                    return {
                        content: [{ type: "text", text: `Payment verification failed: ${result.reason}` }],
                        details: {
                            valid: false,
                            reason: result.reason,
                            confirmations: result.confirmations,
                            amountReceived: koinuToDoge(result.amountReceived),
                            amountExpected: koinuToDoge(result.amountExpected),
                        },
                    };
                }
                catch (err) {
                    return {
                        content: [{ type: "text", text: `Verification error: ${err.message}` }],
                        details: { error: err.message },
                    };
                }
            },
        }, { name: "wallet_verify_payment" });
        // ------------------------------------------------------------------
        // Service: lifecycle management
        // ------------------------------------------------------------------
        api.registerService({
            id: "doge-wallet",
            start: async () => {
                priceService.start();
                // Phase 6: Run mainnet preflight checks and log results
                const preflightResults = runMainnetPreflightChecks(cfg);
                const configValidation = validateMainnetConfig(cfg);
                // Log preflight results to audit trail
                await auditLog.logAudit({
                    action: "preflight_check",
                    reason: `Preflight checks ${preflightResults.passed ? "PASSED" : "WARNINGS"}`,
                    initiatedBy: "system",
                    metadata: {
                        passed: preflightResults.passed,
                        checks: preflightResults.checks.map(c => ({ name: c.name, passed: c.passed })),
                        configWarnings: configValidation.warnings,
                    },
                });
                // Log warnings for operator visibility
                if (configValidation.warnings.length > 0) {
                    for (const warning of configValidation.warnings) {
                        log("warn", `doge-wallet: config warning: ${warning}`);
                    }
                }
                // Log each preflight check result
                for (const check of preflightResults.checks) {
                    const level = check.passed ? "info" : "warn";
                    log(level, `doge-wallet: preflight [${check.name}] ${check.passed ? "✓" : "⚠"} ${check.message}`);
                }
                // Load persisted state
                await utxoManager.load();
                await limitTracker.load();
                await approvalQueue.load();
                await txTracker.load();
                await receiveMonitor.load();
                await invoiceManager.load();
                await loadFreezeState();
                const initialized = await walletManager.isInitialized();
                const walletStatus = initialized ? "🟢 Active" : "🔴 Not initialized";
                let address = null;
                if (initialized) {
                    address = await walletManager.getAddress();
                    // Update A2A components with current address
                    invoiceManager.updateAddress(address);
                    paymentVerifier.updateAddress(address);
                    startUtxoRefresh();
                    startReceiveMonitor(address);
                }
                startApprovalExpiryCheck();
                startInvoiceCleanup();
                // Clean up expired invoices on startup
                cleanupExpiredInvoices(invoiceManager, { log }).catch((err) => {
                    log("warn", `doge-wallet: invoice cleanup failed: ${err.message ?? err}`);
                });
                // Clean up expired onboarding sessions
                onboardingFlow.cleanup().catch((err) => {
                    log("warn", `doge-wallet: onboarding cleanup failed: ${err.message ?? err}`);
                });
                auditLog
                    .logAudit({
                    action: "balance_check",
                    address: address ?? undefined,
                    reason: `Plugin started — Phase 6 (Hardening) — wallet ${initialized ? "initialized" : "not initialized"} — preflight ${preflightResults.passed ? "passed" : "warnings"}`,
                    initiatedBy: "system",
                })
                    .catch(() => { });
                log("info", `doge-wallet: 🐕 Plugin loaded! ${walletStatus} | ` +
                    `Network: ${cfg.network} | Provider: ${cfg.api.primary} | ` +
                    `Notifications: ${cfg.notifications.enabled ? `on (${cfg.notifications.level})` : "off"} | ` +
                    `Policy: ${cfg.policy.enabled ? "enabled" : "disabled"} | ` +
                    `Frozen: ${policyEngine.isFrozen()} | ` +
                    `Preflight: ${preflightResults.passed ? "✓" : "⚠"} | ` +
                    (address ? `Address: ${address} | ` : "") +
                    `Phase 6 (Hardening). Much secure. Wow.`);
            },
            stop: () => {
                stopUtxoRefresh();
                stopApprovalExpiryCheck();
                stopInvoiceCleanup();
                receiveMonitor.stop();
                txTracker.stopPolling();
                walletManager.lock();
                priceService.stop();
                log("info", "doge-wallet: 🐕 Plugin stopped. Wallet locked. Goodbye.");
            },
        });
    },
};
// ============================================================================
// Helper: Create API Provider
// ============================================================================
function createProvider(cfg, which, log) {
    switch (which) {
        case "blockcypher":
            return new BlockCypherProvider(cfg.api.blockcypher);
        case "sochain":
            return new SoChainProvider(cfg.api.sochain, cfg.network);
        default:
            log("warn", `doge-wallet: unknown provider "${which}", using blockcypher`);
            return new BlockCypherProvider(cfg.api.blockcypher);
    }
}
// ============================================================================
// Export
// ============================================================================
export default dogeWalletPlugin;
//# sourceMappingURL=index.js.map