/**
 * DOGE Wallet — Config Loading + Validation
 *
 * Reads config from the plugin API, applies defaults, validates required fields.
 * Much config. Very validate. Wow. 🐕
 */

import type { DogeWalletConfig } from "./types.js";

/** Default configuration — sensible defaults for all optional fields */
const DEFAULTS: DogeWalletConfig = {
  network: "mainnet",
  dataDir: "~/.openclaw/doge",
  api: {
    primary: "blockcypher",
    fallback: "none", // SoChain requires paid API key; set to "sochain" if you have one
    blockcypher: {
      baseUrl: "https://api.blockcypher.com/v1/doge/main",
      apiToken: null,
    },
    sochain: {
      // NOTE: SoChain v3 requires a paid API key. Get one at https://chain.so/api
      // Without an API key, sochain fallback will fail with authentication errors.
      baseUrl: "https://chain.so/api/v3",
      apiKey: null,
    },
    priceApi: {
      provider: "coingecko",
      baseUrl: "https://api.coingecko.com/api/v3",
      cacheTtlSeconds: 300,
    },
  },
  policy: {
    enabled: true,
    tiers: {
      micro:  { maxAmount: 10,    approval: "auto" },
      small:  { maxAmount: 100,   approval: "auto-logged" },
      medium: { maxAmount: 1000,  approval: "notify-delay", delayMinutes: 5 },
      large:  { maxAmount: 10000, approval: "owner-required" },
      sweep:  { maxAmount: null,  approval: "owner-confirm-code" },
    },
    limits: {
      dailyMax: 5000,
      hourlyMax: 1000,
      txCountDailyMax: 50,
      cooldownSeconds: 10,
    },
    allowlist: [],
    denylist: [],
    freeze: false,
  },
  utxo: {
    refreshIntervalSeconds: 120,
    dustThreshold: 100000,
    consolidationThreshold: 50,
    minConfirmations: 1,
  },
  notifications: {
    enabled: true,
    channel: "telegram",
    target: "<YOUR_TELEGRAM_CHAT_ID>",
    lowBalanceAlert: 100,
    lowBalanceAlertIntervalHours: 24,
    dailyLimitWarningPercent: 80,
    level: "important",
  },
  fees: {
    strategy: "medium",
    maxFeePerKb: 200000000,
    fallbackFeePerKb: 100000000,
  },
};

/**
 * Deep merge helper — merges source into target, preferring source values.
 * Only merges plain objects; arrays and primitives are replaced.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = (result as Record<string, unknown>)[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === "object" &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      (result as Record<string, unknown>)[key] = srcVal;
    }
  }
  return result;
}

/**
 * Parse and validate the plugin config.
 * Returns a fully-populated DogeWalletConfig with defaults applied.
 */
export function parseDogeConfig(raw: unknown): DogeWalletConfig {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULTS };
  }

  const cfg = deepMerge(DEFAULTS as unknown as Record<string, unknown>, raw as Record<string, unknown>) as unknown as DogeWalletConfig;

  // Validate network
  if (cfg.network !== "mainnet" && cfg.network !== "testnet") {
    throw new Error(`doge-wallet: invalid network "${cfg.network}" — must be "mainnet" or "testnet"`);
  }

  // Validate primary/fallback providers
  const validProviders = ["blockcypher", "sochain"];
  if (!validProviders.includes(cfg.api.primary)) {
    throw new Error(`doge-wallet: invalid primary provider "${cfg.api.primary}"`);
  }
  if (cfg.api.fallback !== "none" && !validProviders.includes(cfg.api.fallback)) {
    throw new Error(`doge-wallet: invalid fallback provider "${cfg.api.fallback}"`);
  }

  // Validate fee strategy
  if (!["low", "medium", "high"].includes(cfg.fees.strategy)) {
    throw new Error(`doge-wallet: invalid fee strategy "${cfg.fees.strategy}"`);
  }

  return cfg;
}

/**
 * Check if the wallet has been initialized (has a keystore file on disk).
 * Synchronous check — reads file system.
 */
export function isWalletInitialized(config: DogeWalletConfig): boolean {
  const fs = require("node:fs");
  const path = require("node:path");
  const resolvedDir = config.dataDir.replace("~", process.env.HOME ?? "/home/user");
  const keystorePath = path.join(resolvedDir, "keys", "wallet.json");
  try {
    fs.accessSync(keystorePath);
    return true;
  } catch {
    return false;
  }
}
