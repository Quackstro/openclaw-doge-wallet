/**
 * DOGE Wallet — Custom Error Types
 *
 * Much error. Very descriptive. Wow. 🐕
 */

/** Base wallet error — all wallet errors extend this */
export class WalletError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

/** Error communicating with an API provider */
export class ProviderError extends WalletError {
  public readonly provider: string;
  public readonly statusCode?: number;

  constructor(provider: string, message: string, statusCode?: number) {
    super("PROVIDER_ERROR", `[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

/** All API providers are unavailable */
export class ProviderUnavailableError extends WalletError {
  public readonly providers: string[];

  constructor(providers: string[]) {
    super(
      "PROVIDER_UNAVAILABLE",
      `All API providers are down (${providers.join(", ")}). Much sadness. Very offline. 🐕`,
    );
    this.name = "ProviderUnavailableError";
    this.providers = providers;
  }
}

/** Wallet has not been initialized yet */
export class WalletNotInitializedError extends WalletError {
  constructor() {
    super(
      "WALLET_NOT_INITIALIZED",
      "No wallet configured. Run /wallet init to get started. Such empty. 🐕",
    );
    this.name = "WalletNotInitializedError";
  }
}

/** Insufficient funds for the requested transaction */
export class InsufficientFundsError extends WalletError {
  public readonly required?: number;
  public readonly available?: number;

  constructor(message: string);
  constructor(required: number, available: number);
  constructor(messageOrRequired: string | number, available?: number) {
    if (typeof messageOrRequired === "string") {
      // Generic message constructor - prevents leaking internal amounts
      super("INSUFFICIENT_FUNDS", messageOrRequired);
      this.name = "InsufficientFundsError";
    } else {
      // Legacy constructor with amounts (for internal use only)
      super(
        "INSUFFICIENT_FUNDS",
        `Insufficient funds: need ${messageOrRequired} koinu but only have ${available} koinu. Much broke. 🐕`,
      );
      this.name = "InsufficientFundsError";
      this.required = messageOrRequired;
      this.available = available;
    }
  }
}

/** Rate limit exceeded on a provider */
export class RateLimitError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(provider: string, retryAfterMs?: number) {
    super(provider, "Rate limit exceeded. Much request. Very throttle.", 429);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Wallet has already been initialized — refuse to overwrite */
export class WalletAlreadyInitializedError extends WalletError {
  constructor() {
    super(
      "WALLET_ALREADY_INITIALIZED",
      "Wallet already exists. Use /wallet recover to restore from mnemonic, " +
      "or delete the keystore manually to start over. Such caution. 🐕",
    );
    this.name = "WalletAlreadyInitializedError";
  }
}

/** Wallet is locked — private key not in memory */
export class WalletLockedError extends WalletError {
  constructor() {
    super(
      "WALLET_LOCKED",
      "Wallet is locked. Use /wallet unlock to decrypt the keystore. Much secure. 🔒🐕",
    );
    this.name = "WalletLockedError";
  }
}

/** Invalid passphrase — decryption failed */
export class InvalidPassphraseError extends WalletError {
  constructor() {
    super(
      "INVALID_PASSPHRASE",
      "Invalid passphrase — could not decrypt keystore. Such wrong. Very try again. 🐕",
    );
    this.name = "InvalidPassphraseError";
  }
}

/** Invalid mnemonic phrase */
export class InvalidMnemonicError extends WalletError {
  constructor() {
    super(
      "INVALID_MNEMONIC",
      "Invalid mnemonic phrase. Must be a valid BIP39 24-word mnemonic. Much words. Very check. 🐕",
    );
    this.name = "InvalidMnemonicError";
  }
}
