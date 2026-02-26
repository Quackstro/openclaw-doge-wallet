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
import { WalletAlreadyInitializedError, WalletLockedError, WalletNotInitializedError, InvalidPassphraseError, InvalidMnemonicError, WalletError, } from "./src/errors.js";
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
import { OnboardingFlow, setBotToken, deleteUserMessage, } from "./src/onboarding/index.js";
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
        // Telegram Bot Token (for message deletion & notifications)
        // ------------------------------------------------------------------
        // Resolve the best bot token: prefer configured account, fall back to default
        const telegramAccounts = api.config?.channels?.telegram?.accounts ?? {};
        const notifyAccountId = cfg.notifications.accountId;
        const accountToken = notifyAccountId ? telegramAccounts?.[notifyAccountId]?.botToken : undefined;
        const telegramBotToken = accountToken ?? api.config?.channels?.telegram?.botToken;
        if (telegramBotToken) {
            setBotToken(telegramBotToken);
        }
        else {
            log("warn", "doge-wallet: no Telegram bot token found — message auto-delete will not work");
        }
        if (accountToken && notifyAccountId) {
            log("info", `doge-wallet: using ${notifyAccountId} account bot token for notifications`);
        }
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
        const sendNotification = async (message, tokenOverride) => {
            // Priority 1: Direct Telegram API call (fastest)
            const token = tokenOverride ?? telegramBotToken;
            const target = cfg.notifications.target;
            if (token && target) {
                try {
                    const url = `https://api.telegram.org/bot${token}/sendMessage`;
                    const resp = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ chat_id: target, text: message, parse_mode: "Markdown" }),
                    });
                    if (resp.ok)
                        return;
                    const body = await resp.text().catch(() => "");
                    log("warn", `doge-wallet: Telegram API notification failed (${resp.status}): ${body}`);
                }
                catch (err) {
                    log("warn", `doge-wallet: Telegram API notification error: ${err.message}`);
                }
            }
            // Priority 2: Plugin API sendMessage
            try {
                if (typeof api.sendMessage === "function") {
                    await api.sendMessage(message);
                    return;
                }
            }
            catch {
                // fall through to CLI
            }
            // Priority 3: Shell out to OpenClaw CLI (slowest)
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
            // Priority 1: Direct Telegram API call (fastest)
            const token = telegramBotToken;
            const target = cfg.notifications.target;
            if (token && target) {
                try {
                    const payload = { chat_id: target, text: richMsg.text };
                    if (richMsg.keyboard && richMsg.keyboard.length > 0) {
                        payload.reply_markup = { inline_keyboard: richMsg.keyboard };
                    }
                    const url = `https://api.telegram.org/bot${token}/sendMessage`;
                    const resp = await fetch(url, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                    });
                    if (resp.ok)
                        return;
                    const body = await resp.text().catch(() => "");
                    log("warn", `doge-wallet: Telegram API rich notification failed (${resp.status}): ${body}`);
                }
                catch (err) {
                    log("warn", `doge-wallet: Telegram API rich notification error: ${err.message}`);
                }
            }
            // Priority 2: Plugin API
            try {
                if (api.telegram?.sendMessageTelegram) {
                    const opts = {};
                    if (richMsg.keyboard) {
                        opts.buttons = richMsg.keyboard;
                    }
                    await api.telegram.sendMessageTelegram(target, richMsg.text, opts);
                    return;
                }
            }
            catch (err) {
                log("warn", `doge-wallet: telegram send failed: ${err.message ?? err}`);
            }
            // Priority 3: CLI fallback (slowest)
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
            // Self-send protection: prevent sending to own address (wastes fees)
            if (to === address) {
                throw new WalletError("SELF_SEND", "Cannot send to your own address — this would only waste fees.");
            }
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
                maxFee: cfg.fees.maxFeePerKb * 2, // Safety cap: 2x the configured max fee per KB
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
            const MIN_DOGE = 0.001; // dust threshold
            if (!amountDoge || !toAddress || isNaN(amountDoge) || amountDoge < MIN_DOGE || amountDoge > MAX_DOGE || !isFinite(amountDoge)) {
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
                const chatId = ctx.chatId ?? ctx.chat?.id ?? ctx.senderId ?? "unknown";
                const messageId = ctx.messageId ?? ctx.message?.message_id?.toString();
                // Resolve bot token for this account (multi-bot support)
                const actId = ctx.accountId;
                const accountBotToken = actId
                    ? api.config?.channels?.telegram?.accounts?.[actId]?.botToken
                    : undefined;
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
                    case "init": {
                        // SECURITY: Auto-delete message containing passphrase
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log, accountBotToken).catch(() => { });
                        return await handleWalletInit(subArgs, accountBotToken);
                    }
                    case "recover": {
                        // SECURITY: Auto-delete message that may contain mnemonic
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log, accountBotToken).catch(() => { });
                        return await handleWalletRecover(subArgs);
                    }
                    case "address": return await handleWalletAddress();
                    case "lock": return handleWalletLock();
                    case "unlock": {
                        // SECURITY: Auto-delete message containing passphrase
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log, accountBotToken).catch(() => { });
                        return await handleWalletUnlock(subArgs);
                    }
                    case "utxos": return await handleWalletUtxos();
                    case "pending": return handleWalletPending();
                    case "history": return await handleWalletHistory(subArgs);
                    case "freeze": return await handleWalletFreeze();
                    case "unfreeze": return await handleWalletUnfreeze();
                    case "export": {
                        // SECURITY: Auto-delete message that may contain passphrase
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log, accountBotToken).catch(() => { });
                        return await handleWalletExport(subArgs);
                    }
                    case "invoice": return await handleWalletInvoice(subArgs);
                    case "invoices": return await handleWalletInvoices();
                    case "delete":
                    case "destroy": {
                        // SECURITY: Auto-delete message (may contain passphrase)
                        if (messageId)
                            deleteUserMessage(chatId, messageId, log, accountBotToken).catch(() => { });
                        return await handleWalletDelete(subArgs);
                    }
                    default:
                        return {
                            text: `🐕 Unknown command: "${subCmd}"\n` +
                                "Try /wallet help for available commands.",
                        };
                }
            },
        });
        // ------------------------------------------------------------------
        // Auto-reply command: /history — paginated transaction history
        // ------------------------------------------------------------------
        api.registerCommand({
            name: "history",
            description: "🐕 Paginated transaction history with inline buttons",
            acceptsArgs: true,
            handler: async (ctx) => {
                const args = ctx.args?.trim() ?? "";
                return await handleWalletHistory(args);
            },
        });
        // ------------------------------------------------------------------
        // Auto-reply command: /txsearch — prompt for transaction search
        // ------------------------------------------------------------------
        api.registerCommand({
            name: "txsearch",
            description: "🔍 Search transactions by natural language query",
            acceptsArgs: false,
            handler: async () => {
                return {
                    text: "🔍 *Search Transactions*\n\n" +
                        "Describe what you're looking for and I'll find it:\n\n" +
                        '• "payments to Castro last week"\n' +
                        '• "transactions over 10 DOGE"\n' +
                        '• "all received transactions"\n' +
                        '• "fees paid this month"\n\n' +
                        "Just type your query below 👇",
                };
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
                result.channelData = {
                    telegram: {
                        buttons: flowResult.keyboard,
                    },
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
                // Resolve bot token for this account (multi-bot support)
                const actId = ctx.accountId;
                const tokenOverride = actId
                    ? api.config?.channels?.telegram?.accounts?.[actId]?.botToken
                    : undefined;
                const flowResult = await onboardingFlow.handleCallback({
                    chatId,
                    callbackData,
                });
                if (!flowResult) {
                    return { text: "Unknown action." };
                }
                // SECURITY: Auto-delete the bot's mnemonic message when user confirms backup.
                if (flowResult.deleteBotMessageId) {
                    deleteUserMessage(chatId, flowResult.deleteBotMessageId, log, tokenOverride).catch(() => {
                        log("warn", "doge-wallet: failed to auto-delete mnemonic message — user should delete manually");
                    });
                }
                else if (callbackData === "doge:onboard:phrase_saved") {
                    const btnMsgId = ctx.message?.message_id?.toString();
                    if (btnMsgId) {
                        deleteUserMessage(chatId, btnMsgId, log, tokenOverride).catch(() => {
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
                // Resolve bot token for this account (multi-bot support)
                const actId = ctx.accountId;
                const tokenOverride = actId
                    ? api.config?.channels?.telegram?.accounts?.[actId]?.botToken
                    : undefined;
                // Check if user is in onboarding flow
                const isOnboarding = await onboardingFlow.isOnboarding(chatId);
                if (!isOnboarding) {
                    return null;
                }
                // Handle onboarding text input
                const flowResult = await onboardingFlow.handleMessage({
                    chatId,
                    text,
                    messageId,
                });
                if (!flowResult) {
                    return null;
                }
                // SECURITY: Delete the user's message (passphrase)
                if (flowResult.deleteMessageId && messageId) {
                    deleteUserMessage(chatId, messageId, log, tokenOverride).catch(() => { });
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
        async function handleWalletInit(passphrase, tokenOverride) {
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
                // SECURITY: Send mnemonic via direct Telegram message instead of inline
                // to avoid it being stored in session/command history.
                try {
                    await sendNotification(`🔐 DOGE Wallet Recovery Phrase\n━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `⚠️ WRITE THIS DOWN NOW. It will NEVER be shown again.\n` +
                        `Do NOT screenshot. Store physically in a safe place.\n\n` +
                        `${result.mnemonic}\n\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `Address: ${result.address}\n` +
                        `Network: ${cfg.network}`, tokenOverride);
                }
                catch (notifyErr) {
                    log("error", `doge-wallet: CRITICAL - failed to deliver mnemonic via DM: ${notifyErr.message}`);
                    // Last resort: return inline so user doesn't lose funds
                    return {
                        text: "🐕 Wallet Initialized!\n━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                            "⚠️ Secure delivery failed. Save this mnemonic NOW:\n\n" +
                            `🔑 Mnemonic:\n\`${result.mnemonic}\`\n\n` +
                            `📍 Address: ${result.address}\n` +
                            `🌐 Network: ${cfg.network}\n` +
                            "🔓 Status: Unlocked\n\n" +
                            "⚠️ DELETE THIS MESSAGE after saving your mnemonic!",
                    };
                }
                return {
                    text: "🐕 Wallet Initialized!\n━━━━━━━━━━━━━━━━━━━━━━\n\n" +
                        "🔐 Recovery phrase sent via separate message.\n" +
                        "⚠️ Write it down physically and delete the message.\n\n" +
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
            // Step 1: Unlock the wallet (critical — errors here are real failures)
            try {
                await walletManager.unlock(passphrase);
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
            const address = await walletManager.getAddress();
            // Step 2: Refresh balance (non-critical — don't fail the unlock if this errors)
            try {
                if (address) {
                    await utxoManager.refresh(address);
                }
            }
            catch (refreshErr) {
                log("warn", `doge-wallet: balance refresh after unlock failed: ${refreshErr.message}`);
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
            // Signal other plugins that the wallet is now unlocked.
            try {
                const triggerDir = `${process.env.HOME || "/home/clawdbot"}/.openclaw/events`;
                const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
                mkdirSync(triggerDir, { recursive: true });
                const triggerPath = `${triggerDir}/wallet-unlocked`;
                writeFileSync(triggerPath, JSON.stringify({
                    event: "wallet:unlocked",
                    address,
                    timestamp: new Date().toISOString(),
                }));
                chmodSync(triggerPath, 0o644);
                log("info", `doge-wallet: wrote wallet-unlocked event to ${triggerPath}`);
            }
            catch (triggerErr) {
                log("error", `doge-wallet: failed to write wallet-unlocked event: ${triggerErr.message}`);
            }
            return { text };
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
        async function getUnifiedHistory(maxEntries) {
            // 1. Get audit log entries
            const auditEntries = await auditLog.getFullHistory(1000);
            const auditByTxid = new Map();
            for (const e of auditEntries) {
                if (e.txid)
                    auditByTxid.set(e.txid, e);
            }
            const unified = [];
            // Add audit entries first
            for (const e of auditEntries) {
                unified.push({
                    txid: e.txid ?? "unknown",
                    type: e.action === "receive" ? "received" : "sent",
                    amount: e.amount ? koinuToDoge(e.amount) : 0,
                    address: e.address ?? "unknown",
                    fee: e.fee ? koinuToDoge(e.fee) : 0,
                    timestamp: e.timestamp,
                    source: "audit",
                    reason: e.reason,
                    tier: e.tier,
                });
            }
            // 2. Try to fetch on-chain transactions if provider is available
            try {
                const address = await walletManager.getAddress();
                if (address) {
                    const chainTxs = await provider.getTransactions(address, maxEntries);
                    for (const tx of chainTxs) {
                        // Skip if already in audit log
                        if (auditByTxid.has(tx.txid))
                            continue;
                        // Determine direction: did we send or receive?
                        const isInput = tx.inputs.some((inp) => inp.address === address);
                        const isOutput = tx.outputs.some((out) => out.address === address);
                        if (isInput) {
                            // We sent: find the non-change output (not our address)
                            const destOutput = tx.outputs.find((out) => out.address !== address);
                            const changeOutput = tx.outputs.find((out) => out.address === address);
                            const sentAmount = destOutput ? koinuToDoge(destOutput.amount) : koinuToDoge(tx.totalOutput);
                            unified.push({
                                txid: tx.txid,
                                type: "sent",
                                amount: sentAmount,
                                address: destOutput?.address ?? "unknown",
                                fee: koinuToDoge(tx.fee),
                                timestamp: tx.timestamp ?? new Date().toISOString(),
                                source: "chain",
                            });
                        }
                        else if (isOutput) {
                            // We received: sum outputs to our address
                            const receivedAmount = tx.outputs
                                .filter((out) => out.address === address)
                                .reduce((sum, out) => sum + out.amount, 0);
                            const senderAddr = tx.inputs[0]?.address ?? "unknown";
                            unified.push({
                                txid: tx.txid,
                                type: "received",
                                amount: koinuToDoge(receivedAmount),
                                address: senderAddr,
                                fee: koinuToDoge(tx.fee),
                                timestamp: tx.timestamp ?? new Date().toISOString(),
                                source: "chain",
                            });
                        }
                    }
                }
            }
            catch (err) {
                // If chain query fails, we still show audit entries
                log("warn", `doge-wallet: chain history fetch failed: ${err.message}`);
            }
            // 3. Sort by timestamp descending and deduplicate
            unified.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return unified.slice(0, maxEntries);
        }
        async function handleWalletHistory(args) {
            const PAGE_SIZE = 5;
            let offset = Math.max(0, parseInt(args ?? "", 10) || 0);
            // Fetch unified history (audit + on-chain)
            const allEntries = await getUnifiedHistory(200);
            if (allEntries.length === 0) {
                return { text: "🐕 Transaction History\n━━━━━━━━━━━━━━━━━━━━━━\nNo transactions yet. 🐕" };
            }
            // Clamp offset: if beyond available entries, reset to last valid page
            if (offset >= allEntries.length) {
                offset = Math.max(0, Math.floor((allEntries.length - 1) / PAGE_SIZE) * PAGE_SIZE);
            }
            const page = Math.floor(offset / PAGE_SIZE) + 1;
            const totalPages = Math.ceil(allEntries.length / PAGE_SIZE);
            const pageEntries = allEntries.slice(offset, offset + PAGE_SIZE);
            const hasMore = allEntries.length > offset + PAGE_SIZE;
            let text = `💰 Transaction History (page ${page}/${totalPages})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const e of pageEntries) {
                const ts = formatET(e.timestamp);
                const chainTag = e.source === "chain" ? " 🔗" : "";
                if (e.type === "received") {
                    text +=
                        `\n➕ ${formatDoge(e.amount)} DOGE ← ${truncAddr(e.address)}${chainTag}\n` +
                            `    ${ts} · 🔗 ${e.txid.slice(0, 8)}…\n`;
                }
                else {
                    text +=
                        `\n➖ ${formatDoge(e.amount)} DOGE → ${truncAddr(e.address)}${chainTag}\n` +
                            `    ${ts} · ⛽ ${formatDoge(e.fee)} · 🔗 ${e.txid.slice(0, 8)}…\n`;
                    if (e.reason) {
                        text += `    📝 ${e.reason}\n`;
                    }
                }
            }
            if (allEntries.some((e) => e.source === "chain")) {
                text += `\n🔗 = on-chain only (pre-monitoring)\n`;
            }
            // Build inline buttons
            const buttons = [];
            const row = [];
            if (hasMore) {
                row.push({ text: "📜 Show More", callback_data: `/history ${offset + PAGE_SIZE}` });
            }
            row.push({ text: "🔍 Search", callback_data: "/txsearch" });
            buttons.push(row);
            const result = { text };
            if (buttons.length > 0) {
                result.channelData = {
                    telegram: { buttons },
                };
            }
            return result;
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
        async function handleWalletDelete(args) {
            const passphrase = args.trim();
            if (!passphrase) {
                return {
                    text: "🐕 Delete Wallet\n" +
                        "━━━━━━━━━━━━━━━━\n\n" +
                        "⚠️ This permanently destroys your wallet keystore, UTXO cache, and onboarding state.\n" +
                        "Audit logs are preserved for records.\n\n" +
                        "⛔ If you haven't backed up your mnemonic, your funds will be UNRECOVERABLE.\n\n" +
                        "Usage: `/wallet delete <passphrase>`\n" +
                        "Your passphrase is required to confirm deletion.",
                };
            }
            // Verify wallet exists
            const initialized = await walletManager.isInitialized();
            if (!initialized) {
                return { text: "🐕 No wallet to delete — none is configured." };
            }
            // Verify passphrase by attempting unlock
            try {
                await walletManager.unlock(passphrase);
            }
            catch {
                return { text: "❌ Wrong passphrase. Wallet delete aborted." };
            }
            // Lock wallet before deletion
            walletManager.lock();
            // Get balance warning
            const balance = utxoManager.getBalance();
            const totalDoge = koinuToDoge(balance.confirmed + balance.unconfirmed);
            // Audit the deletion
            await auditLog.logAudit({
                action: "wallet_deleted",
                initiatedBy: "owner",
                reason: totalDoge > 0
                    ? `Wallet deleted with ${formatDoge(totalDoge)} DOGE remaining`
                    : "Wallet deleted (zero balance)",
            });
            // Delete everything in the data dir EXCEPT the audit directory
            const { join } = await import("node:path");
            const { rmSync, existsSync, readdirSync } = await import("node:fs");
            let deleted = 0;
            if (existsSync(resolvedDataDir)) {
                const entries = readdirSync(resolvedDataDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name === "audit")
                        continue; // preserve audit logs
                    const fullPath = join(resolvedDataDir, entry.name);
                    try {
                        rmSync(fullPath, { recursive: true });
                        deleted++;
                    }
                    catch (err) {
                        log("warn", `doge-wallet: failed to delete ${fullPath}: ${err.message}`);
                    }
                }
            }
            const balanceWarning = totalDoge > 0
                ? `\n\n⚠️ Wallet had ${formatDoge(totalDoge)} DOGE. Ensure you have your mnemonic backup to recover funds.`
                : "";
            return {
                text: "🐕 Wallet Deleted\n" +
                    "━━━━━━━━━━━━━━━━━\n\n" +
                    `✅ Removed ${deleted} wallet file(s).\n` +
                    "📋 Audit logs preserved.\n" +
                    balanceWarning +
                    "\n\nTo create a new wallet: /wallet init <passphrase>",
            };
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
                    "  /wallet unfreeze — Resume sends\n" +
                    "  /wallet delete <passphrase> — Permanently delete wallet\n\n" +
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
                const entries = await getUnifiedHistory(limit);
                if (entries.length === 0) {
                    return {
                        content: [{ type: "text", text: "No transaction history yet." }],
                        details: { transactions: [], count: 0 },
                    };
                }
                const summary = entries
                    .map((t) => {
                    const icon = t.type === "received" ? "➕" : "➖";
                    const arrow = t.type === "received" ? "←" : "→";
                    const src = t.source === "chain" ? " 🔗" : "";
                    return `${icon} ${formatDoge(t.amount)} DOGE ${arrow} ${truncAddr(t.address)} (${formatET(t.timestamp)})${src}`;
                })
                    .join("\n");
                const hasChain = entries.some((e) => e.source === "chain");
                const footer = hasChain ? "\n\n🔗 = on-chain only (pre-monitoring)" : "";
                return {
                    content: [{ type: "text", text: `Recent transactions:\n${summary}${footer}` }],
                    details: { transactions: entries, count: entries.length },
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
                // Validate txid format (64-char hex string)
                if (!/^[0-9a-fA-F]{64}$/.test(params.txid)) {
                    return {
                        content: [{ type: "text", text: "Invalid transaction ID format." }],
                        details: { error: "INVALID_TXID" },
                    };
                }
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
        // ==================================================================
        // Quackstro Protocol (QP) — Agent-to-Agent Economy
        // ==================================================================
        // Lazy-init QP client/provider (only when wallet is unlocked)
        let qpClient = null;
        let qpProvider = null;
        // Dynamic imports to avoid loading QP modules unless needed
        let QPClientClass;
        let QPProviderClass;
        let QPCallState;
        async function loadQPModules() {
            if (QPClientClass)
                return;
            const clientMod = await import('./src/qp/orchestrator/client.js');
            const providerMod = await import('./src/qp/orchestrator/provider.js');
            const typesMod = await import('./src/qp/orchestrator/types.js');
            QPClientClass = clientMod.QPClient;
            QPProviderClass = providerMod.QPProvider;
            QPCallState = typesMod.CallState;
        }
        async function ensureQPClient() {
            const initialized = await walletManager.isInitialized();
            if (!initialized || !walletManager.isUnlocked()) {
                // Destroy cached instance if wallet is locked
                if (qpClient) {
                    qpClient.destroy();
                    qpClient = null;
                }
                throw new Error('Wallet must be initialized and unlocked for QP operations');
            }
            if (qpClient)
                return qpClient;
            await loadQPModules();
            const address = await walletManager.getAddress();
            const privkey = walletManager.getPrivateKey();
            // Derive compressed public key from private key via bitcore
            const { createRequire: cr } = await import('module');
            const req = cr(import.meta.url);
            const bc = req('bitcore-lib-doge');
            const pubkey = Buffer.from(new bc.PrivateKey(privkey).publicKey.toBuffer());
            const privkeyCopy = Buffer.from(privkey);
            privkey.fill(0); // Zero caller's copy
            qpClient = new QPClientClass({
                address: address,
                pubkey: pubkey,
                privkey: privkeyCopy,
                provider,
                getUtxos: async () => utxoManager.getUtxos(),
                changeAddress: address,
            });
            return qpClient;
        }
        async function ensureQPProvider() {
            const initialized = await walletManager.isInitialized();
            if (!initialized || !walletManager.isUnlocked()) {
                if (qpProvider) {
                    qpProvider.destroy();
                    qpProvider = null;
                }
                throw new Error('Wallet must be initialized and unlocked for QP provider mode');
            }
            if (qpProvider)
                return qpProvider;
            await loadQPModules();
            const address = await walletManager.getAddress();
            const privkey = walletManager.getPrivateKey();
            const { createRequire: cr } = await import('module');
            const req = cr(import.meta.url);
            const bc = req('bitcore-lib-doge');
            const pubkey = Buffer.from(new bc.PrivateKey(privkey).publicKey.toBuffer());
            const privkeyCopy = Buffer.from(privkey);
            privkey.fill(0); // Zero caller's copy
            // Convert config skills to SkillRegistration format
            const defaultFlags = {
                supportsDirectHtlc: true,
                supportsSideloadHttps: true,
                supportsSideloadLibp2p: false,
                supportsSideloadIpfs: false,
                onlineNow: true,
                supportsPaymentChannel: false,
                acceptsPostPayment: false,
                isCompositeTool: false,
            };
            const skills = (cfg.qp?.skills ?? []).map((s) => ({
                skillCode: s.skillCode,
                priceKoinu: Math.round(s.priceDoge * 100_000_000),
                priceUnit: s.priceUnit ?? 0,
                description: s.description,
                flags: defaultFlags,
                handler: async (request) => {
                    // Default handler — returns stub. Real handlers registered via hooks (future).
                    return { status: 'ok', skill: s.skillCode, message: 'Skill handler not configured' };
                },
            }));
            qpProvider = new QPProviderClass({
                address: address,
                pubkey: pubkey,
                privkey: privkeyCopy,
                provider,
                getUtxos: async () => utxoManager.getUtxos(),
                changeAddress: address,
                skills,
                advertiseTtlBlocks: cfg.qp?.advertiseTtlBlocks ?? 10_080,
                scanIntervalMs: cfg.qp?.scanIntervalMs ?? 60_000,
            });
            return qpProvider;
        }
        // ------------------------------------------------------------------
        // Command: /qp — Quackstro Protocol hub
        // ------------------------------------------------------------------
        api.registerCommand({
            name: "qp",
            description: "🦆 Quackstro Protocol — agent-to-agent services on DOGE",
            acceptsArgs: true,
            handler: async (ctx) => {
                const args = ctx.args?.trim() ?? "";
                const chatId = ctx.chatId ?? ctx.chat?.id ?? ctx.senderId ?? "unknown";
                const sub = args.split(/\s+/)[0]?.toLowerCase() ?? "";
                const rest = args.slice(sub.length).trim();
                if (!sub || sub === "help") {
                    return `🦆 **Quackstro Protocol**\n\n` +
                        `**Consumer:**\n` +
                        `\`/qp discover <skill>\` — Find providers for a skill\n` +
                        `\`/qp directory\` — List known providers\n\n` +
                        `**Provider:**\n` +
                        `\`/qp advertise\` — Broadcast skills on-chain\n` +
                        `\`/qp provider start\` — Start listening for requests\n` +
                        `\`/qp provider stop\` — Stop listening\n\n` +
                        `**General:**\n` +
                        `\`/qp status\` — Show QP status\n\n` +
                        `_Agent-to-agent economy on Dogecoin_ 🐕`;
                }
                if (sub === "status") {
                    const initialized = await walletManager.isInitialized();
                    const unlocked = walletManager.isUnlocked();
                    const clientActive = qpClient !== null;
                    const providerActive = qpProvider !== null;
                    let providerSessions = 0;
                    if (qpProvider)
                        providerSessions = qpProvider.sessionCount;
                    let directorySize = 0;
                    if (qpClient)
                        directorySize = qpClient.getDirectory().size;
                    return `🦆 **QP Status**\n\n` +
                        `Wallet: ${initialized ? (unlocked ? '🟢 Unlocked' : '🟡 Locked') : '🔴 Not init'}\n` +
                        `Client: ${clientActive ? '🟢 Active' : '⚪ Inactive'}\n` +
                        `Provider: ${providerActive ? `🟢 Active (${providerSessions} sessions)` : '⚪ Inactive'}\n` +
                        `Directory: ${directorySize} known providers`;
                }
                if (sub === "discover") {
                    if (!rest)
                        return "Usage: `/qp discover <skillCode>` — e.g. `/qp discover 0x0403`";
                    const skillCode = parseInt(rest, rest.startsWith('0x') ? 16 : 10);
                    if (isNaN(skillCode))
                        return "Invalid skill code. Use hex (0x0403) or decimal.";
                    try {
                        const client = await ensureQPClient();
                        const providers = await client.discoverProviders(skillCode);
                        if (providers.length === 0) {
                            return `No providers found for skill 0x${skillCode.toString(16).padStart(4, '0')}.`;
                        }
                        const lines = providers.slice(0, 10).map((p, i) => `${i + 1}. \`${p.providerAddress.slice(0, 12)}…\` — ${formatDoge(p.priceKoinu / 1e8)} DOGE — ${p.description || 'no desc'}`);
                        return `🦆 **Providers for 0x${skillCode.toString(16).padStart(4, '0')}**\n\n` +
                            lines.join('\n') +
                            (providers.length > 10 ? `\n\n_...and ${providers.length - 10} more_` : '');
                    }
                    catch (err) {
                        return `Discovery failed: ${err.message}`;
                    }
                }
                if (sub === "directory") {
                    try {
                        const client = await ensureQPClient();
                        const status = await provider.getNetworkInfo();
                        const directory = client.getDirectory();
                        const active = directory.getActive(status.height);
                        if (active.length === 0)
                            return "Directory is empty. Run `/qp discover <skillCode>` to scan.";
                        const lines = active.slice(0, 15).map(l => `• 0x${l.skillCode.toString(16).padStart(4, '0')} — \`${l.providerAddress.slice(0, 12)}…\` — ${formatDoge(l.priceKoinu / 1e8)} DOGE — ${l.description || '-'}`);
                        return `🦆 **Service Directory** (${active.length} active)\n\n` + lines.join('\n');
                    }
                    catch (err) {
                        return `Directory error: ${err.message}`;
                    }
                }
                if (sub === "advertise") {
                    try {
                        const provider = await ensureQPProvider();
                        const skills = cfg.qp?.skills ?? [];
                        if (skills.length === 0) {
                            return "No skills configured. Add skills to your plugin config under `qp.skills`.";
                        }
                        const txIds = await provider.advertise();
                        const lines = txIds.map((txid, i) => `${i + 1}. 0x${skills[i].skillCode.toString(16).padStart(4, '0')} — ${skills[i].description} — \`${txid.slice(0, 12)}…\``);
                        return `🦆 **Advertised ${txIds.length} skill(s)**\n\n` + lines.join('\n');
                    }
                    catch (err) {
                        return `Advertise failed: ${err.message}`;
                    }
                }
                if (sub === "provider") {
                    const provSub = rest.split(/\s+/)[0]?.toLowerCase() ?? "";
                    if (provSub === "start") {
                        try {
                            const provider = await ensureQPProvider();
                            provider.start();
                            return "🦆 Provider mode **started**. Scanning for incoming handshakes.";
                        }
                        catch (err) {
                            return `Provider start failed: ${err.message}`;
                        }
                    }
                    if (provSub === "stop") {
                        if (!qpProvider)
                            return "Provider is not running.";
                        qpProvider.stop();
                        return "🦆 Provider mode **stopped**.";
                    }
                    if (provSub === "status" || !provSub) {
                        const running = qpProvider !== null;
                        const sessions = qpProvider?.sessionCount ?? 0;
                        const skills = cfg.qp?.skills ?? [];
                        const skillLines = skills.map(s => `  • 0x${s.skillCode.toString(16).padStart(4, '0')} — ${s.description} — ${s.priceDoge} DOGE`);
                        return `🦆 **Provider Status**\n\n` +
                            `Running: ${running ? '🟢 Yes' : '⚪ No'}\n` +
                            `Sessions: ${sessions}\n` +
                            `Skills (${skills.length}):\n` + (skillLines.length ? skillLines.join('\n') : '  (none configured)');
                    }
                    return `Unknown provider command. Try \`/qp provider start\` or \`/qp provider stop\`.`;
                }
                return `Unknown subcommand: \`${sub}\`. Try \`/qp help\`.`;
            },
        });
        // ------------------------------------------------------------------
        // Tool: qp_discover — AI-accessible service discovery
        // ------------------------------------------------------------------
        api.registerTool({
            name: "qp_discover",
            label: "QP Service Discovery",
            description: "Discover agent-to-agent service providers on the Dogecoin blockchain. " +
                "Searches the QP registry for providers offering a specific skill code. " +
                "Returns provider addresses, prices, and descriptions.",
            parameters: Type.Object({
                skillCode: Type.Number({ description: "Skill code to search for (e.g. 0x0403 = OCR)" }),
                maxPriceDoge: Type.Optional(Type.Number({ description: "Maximum price in DOGE" })),
            }),
            async execute(_toolCallId, params) {
                try {
                    const client = await ensureQPClient();
                    const maxPriceKoinu = params.maxPriceDoge
                        ? Math.round(params.maxPriceDoge * 100_000_000)
                        : undefined;
                    const providers = await client.discoverProviders(params.skillCode, maxPriceKoinu);
                    return {
                        content: [{
                                type: "text",
                                text: providers.length === 0
                                    ? `No providers found for skill 0x${params.skillCode.toString(16)}.`
                                    : `Found ${providers.length} provider(s) for skill 0x${params.skillCode.toString(16)}:\n` +
                                        providers.slice(0, 10).map((p, i) => `${i + 1}. ${p.providerAddress} — ${formatDoge(p.priceKoinu / 1e8)} DOGE — ${p.description}`).join('\n'),
                            }],
                        details: {
                            skillCode: params.skillCode,
                            count: providers.length,
                            providers: providers.slice(0, 10).map(p => ({
                                address: p.providerAddress,
                                priceKoinu: p.priceKoinu,
                                priceDoge: p.priceKoinu / 100_000_000,
                                description: p.description,
                                skillCode: p.skillCode,
                                expiresAtBlock: p.expiresAtBlock,
                            })),
                        },
                    };
                }
                catch (err) {
                    return {
                        content: [{ type: "text", text: `Discovery error: ${err.message}` }],
                        details: { error: err.message },
                    };
                }
            },
        }, { name: "qp_discover" });
        // ------------------------------------------------------------------
        // Tool: qp_pay — Pay a provider for a service
        // ------------------------------------------------------------------
        api.registerTool({
            name: "qp_pay",
            label: "QP Pay Provider",
            description: "Pay a QP provider for an agent-to-agent service. " +
                "Builds and broadcasts a payment transaction with OP_RETURN metadata. " +
                "Also submits an on-chain rating.",
            parameters: Type.Object({
                providerAddress: Type.String({ description: "Provider's DOGE address" }),
                amountDoge: Type.Number({ description: "Payment amount in DOGE" }),
                skillCode: Type.Number({ description: "Skill code that was used" }),
                sessionId: Type.Number({ description: "QP session ID" }),
                rating: Type.Optional(Type.Number({ description: "Rating 1-5 (default 5)" })),
                reason: Type.String({ description: "Why this payment is being made (audit)" }),
            }),
            async execute(_toolCallId, params) {
                try {
                    // Policy check
                    const amountKoinu = Math.round(params.amountDoge * 100_000_000);
                    const policyResult = policyEngine.evaluate(params.amountDoge, params.providerAddress, params.reason);
                    if (!policyResult.allowed && policyResult.action !== 'auto') {
                        return {
                            content: [{ type: "text", text: `Policy blocked: ${policyResult.reason}` }],
                            details: { blocked: true, reason: policyResult.reason, tier: policyResult.tier },
                        };
                    }
                    const client = await ensureQPClient();
                    // Look up provider pubkey from directory (populated by prior discovery)
                    const directory = client.getDirectory();
                    const listings = directory.findByProvider(params.providerAddress);
                    const providerPubkey = listings.length > 0
                        ? listings[0].providerPubkey
                        : Buffer.alloc(33); // fallback if not in directory
                    const payResult = await client.pay({
                        providerAddress: params.providerAddress,
                        providerPubkey,
                        amountKoinu,
                        method: 'htlc',
                        sessionId: params.sessionId,
                        skillCode: params.skillCode,
                    });
                    await auditLog.logAudit({
                        action: "qp_payment",
                        address: params.providerAddress,
                        amount: amountKoinu,
                        txid: payResult.txId,
                        reason: params.reason,
                        initiatedBy: "agent",
                        metadata: { skillCode: params.skillCode, sessionId: params.sessionId },
                    });
                    return {
                        content: [{
                                type: "text",
                                text: `QP payment sent: ${params.amountDoge} DOGE to ${params.providerAddress}. TxID: ${payResult.txId}`,
                            }],
                        details: {
                            txId: payResult.txId,
                            amountDoge: params.amountDoge,
                            amountKoinu,
                            providerAddress: params.providerAddress,
                            skillCode: params.skillCode,
                            sessionId: params.sessionId,
                        },
                    };
                }
                catch (err) {
                    return {
                        content: [{ type: "text", text: `QP payment error: ${err.message}` }],
                        details: { error: err.message },
                    };
                }
            },
        }, { name: "qp_pay" });
        // ------------------------------------------------------------------
        // Tool: qp_status — QP protocol status for AI
        // ------------------------------------------------------------------
        api.registerTool({
            name: "qp_status",
            label: "QP Protocol Status",
            description: "Get the current status of the Quackstro Protocol system. " +
                "Shows client/provider state, directory size, and session count.",
            parameters: Type.Object({}),
            async execute() {
                const initialized = await walletManager.isInitialized();
                const unlocked = walletManager.isUnlocked();
                return {
                    content: [{
                            type: "text",
                            text: `QP Status: wallet ${initialized ? (unlocked ? 'unlocked' : 'locked') : 'not initialized'}. ` +
                                `Client: ${qpClient ? 'active' : 'inactive'}. ` +
                                `Provider: ${qpProvider ? `active (${qpProvider.sessionCount} sessions)` : 'inactive'}. ` +
                                `Directory: ${qpClient ? qpClient.getDirectory().size : 0} providers.`,
                        }],
                    details: {
                        walletInitialized: initialized,
                        walletUnlocked: unlocked,
                        clientActive: qpClient !== null,
                        providerActive: qpProvider !== null,
                        providerSessions: qpProvider?.sessionCount ?? 0,
                        directorySize: qpClient?.getDirectory().size ?? 0,
                    },
                };
            },
        }, { name: "qp_status" });
        // ------------------------------------------------------------------
        // Tool: qp_advertise — Advertise skills on-chain
        // ------------------------------------------------------------------
        api.registerTool({
            name: "qp_advertise",
            label: "QP Advertise Skills",
            description: "Advertise this agent's skills on the Dogecoin blockchain. " +
                "Broadcasts SERVICE_ADVERTISE transactions to QP registry addresses. " +
                "Skills must be configured in the plugin config under qp.skills.",
            parameters: Type.Object({}),
            async execute() {
                try {
                    const skills = cfg.qp?.skills ?? [];
                    if (skills.length === 0) {
                        return {
                            content: [{ type: "text", text: "No skills configured. Add skills to plugin config under qp.skills." }],
                            details: { error: "NO_SKILLS_CONFIGURED" },
                        };
                    }
                    const provider = await ensureQPProvider();
                    const txIds = await provider.advertise();
                    await auditLog.logAudit({
                        action: "qp_discovery",
                        reason: `Advertised ${txIds.length} skill(s) on-chain`,
                        initiatedBy: "agent",
                        metadata: { txIds, skills: skills.map(s => ({ skillCode: s.skillCode, description: s.description })) },
                    });
                    return {
                        content: [{
                                type: "text",
                                text: `Advertised ${txIds.length} skill(s) on-chain:\n` +
                                    txIds.map((txid, i) => `${i + 1}. 0x${skills[i].skillCode.toString(16).padStart(4, '0')} (${skills[i].description}) — txid: ${txid}`).join('\n'),
                            }],
                        details: {
                            count: txIds.length,
                            txIds,
                            skills: skills.map((s, i) => ({
                                skillCode: s.skillCode,
                                description: s.description,
                                priceDoge: s.priceDoge,
                                txId: txIds[i],
                            })),
                        },
                    };
                }
                catch (err) {
                    return {
                        content: [{ type: "text", text: `Advertise error: ${err.message}` }],
                        details: { error: err.message },
                    };
                }
            },
        }, { name: "qp_advertise" });
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
                // QP cleanup
                if (qpClient) {
                    qpClient.destroy();
                    qpClient = null;
                }
                if (qpProvider) {
                    qpProvider.destroy();
                    qpProvider = null;
                }
                stopUtxoRefresh();
                stopApprovalExpiryCheck();
                stopInvoiceCleanup();
                receiveMonitor.stop();
                txTracker.stopPolling();
                walletManager.lock();
                priceService.stop();
                rateLimiter.saveState();
                // Clean up process-level shutdown handlers to prevent leaks
                process.removeListener('SIGTERM', shutdownHandler);
                process.removeListener('SIGINT', shutdownHandler);
                process.removeListener('beforeExit', shutdownHandler);
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