/**
 * DOGE Wallet — Type Definitions
 *
 * All TypeScript interfaces for the Dogecoin wallet plugin.
 * Much types. Very strict. Wow. 🐕
 */

// ============================================================================
// Network Parameters
// ============================================================================

export interface DogeNetworkParams {
  messagePrefix: string;
  bech32: string;
  bip32: {
    public: number;
    private: number;
  };
  pubKeyHash: number;
  scriptHash: number;
  wif: number;
}

export const DOGE_MAINNET: DogeNetworkParams = {
  messagePrefix: "\x19Dogecoin Signed Message:\n",
  bech32: "",
  bip32: {
    public: 0x02facafd,  // dgub
    private: 0x02fac398, // dgpv
  },
  pubKeyHash: 0x1e, // D... addresses
  scriptHash: 0x16, // 9... or A... addresses
  wif: 0x9e,
};

export const DOGE_TESTNET: DogeNetworkParams = {
  messagePrefix: "\x19Dogecoin Signed Message:\n",
  bech32: "",
  bip32: {
    public: 0x0432a9a8,  // tgub
    private: 0x0432a243, // tgpv
  },
  pubKeyHash: 0x71, // n... addresses
  scriptHash: 0xc4,
  wif: 0xf1,
};

// ============================================================================
// API Provider Types
// ============================================================================

/** Unspent Transaction Output */
export interface UTXO {
  txid: string;
  vout: number;
  address: string;
  /** Amount in koinu (1 DOGE = 100,000,000 koinu) */
  amount: number;
  scriptPubKey: string;
  confirmations: number;
  blockHeight?: number;
  locked: boolean;
  lockedAt?: string;
  lockedFor?: string;
}

/** Transaction record */
export interface Transaction {
  txid: string;
  blockHeight?: number;
  confirmations: number;
  timestamp?: string;
  inputs: Array<{
    address: string;
    amount: number;
  }>;
  outputs: Array<{
    address: string;
    amount: number;
    scriptType?: string;
    script?: string;
  }>;
  fee: number;
  /** Total value of the transaction */
  totalInput: number;
  totalOutput: number;
}

/** Fee estimate from the network */
export interface FeeEstimate {
  /** Fast confirmation (1-2 blocks) — koinu per byte */
  high: number;
  /** Normal confirmation (3-5 blocks) — koinu per byte */
  medium: number;
  /** Economy (10+ blocks) — koinu per byte */
  low: number;
}

/** Network info from a provider */
export interface NetworkInfo {
  height: number;
  feeEstimate: FeeEstimate;
}

/** Abstract provider interface — see src/api/provider.ts */
export interface DogeApiProvider {
  readonly name: string;
  getBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }>;
  getUtxos(address: string): Promise<UTXO[]>;
  getTransaction(txid: string): Promise<Transaction>;
  getTransactions(address: string, limit: number): Promise<Transaction[]>;
  broadcastTx(rawHex: string): Promise<{ txid: string }>;
  getNetworkInfo(): Promise<NetworkInfo>;
}

// ============================================================================
// Wallet Types
// ============================================================================

/** Balance information */
export interface WalletBalance {
  /** Confirmed DOGE balance */
  confirmed: number;
  /** Unconfirmed (pending) DOGE balance */
  unconfirmed: number;
  /** Total DOGE (confirmed + unconfirmed) */
  total: number;
  /** Approximate USD value */
  usdValue: number | null;
  /** Number of UTXOs */
  utxoCount: number;
  /** Current receiving address */
  address: string;
}

/** Result of a send operation */
export interface SendResult {
  status: "sent" | "pending-approval" | "denied";
  txid?: string;
  approvalId?: string;
  fee?: number;
  message: string;
}

// ============================================================================
// Config Types
// ============================================================================

export interface BlockCypherConfig {
  baseUrl: string;
  apiToken: string | null;
}

export interface SoChainConfig {
  baseUrl: string;
  apiKey: string | null;
}

export interface PriceApiConfig {
  provider: "coingecko";
  baseUrl: string;
  cacheTtlSeconds: number;
}

export interface ApiConfig {
  primary: "blockcypher" | "sochain";
  fallback: "blockcypher" | "sochain" | "none";
  blockcypher: BlockCypherConfig;
  sochain: SoChainConfig;
  priceApi: PriceApiConfig;
}

export interface SpendingTier {
  maxAmount: number | null;
  approval: "auto" | "auto-logged" | "notify-delay" | "owner-required" | "owner-confirm-code";
  delayMinutes?: number;
}

export interface SpendingLimits {
  dailyMax: number;
  hourlyMax: number;
  txCountDailyMax: number;
  cooldownSeconds: number;
}

export interface PolicyConfig {
  enabled: boolean;
  tiers: {
    micro: SpendingTier;
    small: SpendingTier;
    medium: SpendingTier;
    large: SpendingTier;
    sweep: SpendingTier;
  };
  limits: SpendingLimits;
  allowlist: string[];
  denylist: string[];
  freeze: boolean;
}

export interface UtxoConfig {
  refreshIntervalSeconds: number;
  dustThreshold: number;
  consolidationThreshold: number;
  minConfirmations: number;
}

export type NotificationLevel = "all" | "important" | "critical";

export interface NotificationsConfig {
  enabled: boolean;
  channel: string;
  target: string;
  lowBalanceAlert: number;
  /** Hours between low balance alerts (default: 24). Set to 0 for no rate limiting. */
  lowBalanceAlertIntervalHours: number;
  dailyLimitWarningPercent: number;
  level: NotificationLevel;
}

export interface FeesConfig {
  strategy: "low" | "medium" | "high";
  maxFeePerKb: number;
  fallbackFeePerKb: number;
}

export interface DogeWalletConfig {
  network: "mainnet" | "testnet";
  dataDir: string;
  api: ApiConfig;
  policy: PolicyConfig;
  utxo: UtxoConfig;
  notifications: NotificationsConfig;
  fees: FeesConfig;
}

// ============================================================================
// Audit Types
// ============================================================================

export type AuditAction =
  | "send"
  | "receive"
  | "approve"
  | "deny"
  | "freeze"
  | "unfreeze"
  | "consolidate"
  | "invoice_created"
  | "invoice_paid"
  | "key_rotation"
  | "address_generated"
  | "policy_change"
  | "balance_check"
  | "preflight_check"
  | "error";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  txid?: string;
  /** Amount in koinu */
  amount?: number;
  address?: string;
  /** Fee in koinu */
  fee?: number;
  tier?: string;
  reason?: string;
  initiatedBy: "agent" | "owner" | "system" | "external";
  approvalId?: string;
  /** Balance before action (koinu) */
  balanceBefore?: number;
  /** Balance after action (koinu) */
  balanceAfter?: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Key Management Types
// ============================================================================

/** BIP44 derivation result — public/private key pair with address */
export interface KeyPair {
  /** Compressed public key (33 bytes, hex) */
  publicKey: string;
  /** Private key (32 bytes, hex) — NEVER log this */
  privateKey: Buffer;
  /** Derived DOGE address (P2PKH) */
  address: string;
  /** BIP44 derivation path used */
  derivationPath: string;
  /** Derivation index */
  index: number;
}

/** AES-256-GCM encrypted keystore on disk */
export interface EncryptedKeystore {
  version: 1;
  crypto: {
    cipher: "aes-256-gcm";
    ciphertext: string;
    iv: string;
    tag: string;
    kdf: "scrypt";
    kdfparams: {
      n: number;
      r: number;
      p: number;
      salt: string;
      dklen: number;
    };
  };
  address: string;
  network: "mainnet" | "testnet";
}

/** Runtime wallet state — tracks lock/unlock status */
export interface WalletState {
  initialized: boolean;
  unlocked: boolean;
  address: string | null;
  network: "mainnet" | "testnet";
}

/** Public-safe wallet info returned by tools/commands */
export interface WalletInfo {
  initialized: boolean;
  unlocked: boolean;
  address: string | null;
  network: "mainnet" | "testnet";
  publicKey: string | null;
}

/** Passphrase delivery mode */
export type PassphraseMode = "session" | "keyring" | "env";

// ============================================================================
// UTXO Management Types (Phase 2)
// ============================================================================

/** Result of coin selection algorithm */
export interface CoinSelectionResult {
  /** Selected UTXOs to use as inputs */
  selected: UTXO[];
  /** Total input value in koinu */
  totalInput: number;
  /** Estimated fee in koinu */
  fee: number;
  /** Change to return to own address in koinu (0 if exact match) */
  change: number;
  /** Algorithm that was used */
  algorithm: "exact-match" | "branch-and-bound" | "largest-first";
}

/** Cached UTXO set persisted to disk */
export interface UtxoCache {
  /** Cache format version */
  version: 1;
  /** Address this cache is for */
  address: string;
  /** Cached UTXOs */
  utxos: UTXO[];
  /** Last refresh timestamp (ISO 8601) */
  lastRefreshed: string;
  /** Confirmed balance in koinu (from last refresh) */
  confirmedBalance: number;
  /** Unconfirmed balance in koinu (from last refresh) */
  unconfirmedBalance: number;
}

/** Consolidation recommendation for the user */
export interface ConsolidationRecommendation {
  /** Whether consolidation is recommended */
  shouldConsolidate: boolean;
  /** Reason for the recommendation */
  reason: string;
  /** Total number of UTXOs */
  utxoCount: number;
  /** Number of dust UTXOs (below threshold) */
  dustCount: number;
  /** Estimated fee for consolidation in koinu */
  estimatedFee: number;
  /** Number of UTXOs that would be consolidated */
  consolidateCount: number;
}

/** Structured balance data returned by agent tools */
export interface BalanceInfo {
  /** Confirmed balance in DOGE */
  confirmed: number;
  /** Unconfirmed balance in DOGE */
  unconfirmed: number;
  /** Total in DOGE */
  total: number;
  /** USD equivalent (null if price unavailable) */
  usd: number | null;
  /** Wallet address */
  address: string;
  /** Number of UTXOs */
  utxoCount: number;
  /** Last UTXO refresh time (ISO 8601) */
  lastRefreshed: string | null;
  /** Network */
  network: "mainnet" | "testnet";
}

// ============================================================================
// Constants
// ============================================================================

/** 1 DOGE = 100,000,000 koinu */
export const KOINU_PER_DOGE = 100_000_000;

/** Convert DOGE to koinu */
export function dogeToKoinu(doge: number): number {
  return Math.round(doge * KOINU_PER_DOGE);
}

/** Convert koinu to DOGE */
export function koinuToDoge(koinu: number): number {
  return koinu / KOINU_PER_DOGE;
}
