/**
 * DOGE Wallet — Custom Error Types
 *
 * Much error. Very descriptive. Wow. 🐕
 */
/** Base wallet error — all wallet errors extend this */
export declare class WalletError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Error communicating with an API provider */
export declare class ProviderError extends WalletError {
    readonly provider: string;
    readonly statusCode?: number;
    constructor(provider: string, message: string, statusCode?: number);
}
/** All API providers are unavailable */
export declare class ProviderUnavailableError extends WalletError {
    readonly providers: string[];
    constructor(providers: string[]);
}
/** Wallet has not been initialized yet */
export declare class WalletNotInitializedError extends WalletError {
    constructor();
}
/** Insufficient funds for the requested transaction */
export declare class InsufficientFundsError extends WalletError {
    readonly required?: number;
    readonly available?: number;
    constructor(message: string);
    constructor(required: number, available: number);
}
/** Rate limit exceeded on a provider */
export declare class RateLimitError extends ProviderError {
    readonly retryAfterMs?: number;
    constructor(provider: string, retryAfterMs?: number);
}
/** Wallet has already been initialized — refuse to overwrite */
export declare class WalletAlreadyInitializedError extends WalletError {
    constructor();
}
/** Wallet is locked — private key not in memory */
export declare class WalletLockedError extends WalletError {
    constructor();
}
/** Invalid passphrase — decryption failed */
export declare class InvalidPassphraseError extends WalletError {
    constructor();
}
/** Invalid mnemonic phrase */
export declare class InvalidMnemonicError extends WalletError {
    constructor();
}
//# sourceMappingURL=errors.d.ts.map