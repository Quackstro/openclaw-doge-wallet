/**
 * DOGE Wallet — Key Manager
 *
 * Manages wallet lifecycle: init, recover, lock, unlock, auto-lock.
 * Keys are encrypted at rest with AES-256-GCM (scrypt KDF).
 * Private keys are held in memory only while unlocked and zeroed on lock.
 *
 * Much secure. Very encrypt. Wow. 🐕
 */
type LogFn = (level: "info" | "warn" | "error", msg: string) => void;
export declare class WalletManager {
    private readonly dataDir;
    private readonly network;
    private readonly keystoreDir;
    private readonly keystorePath;
    private readonly log;
    private _privateKey;
    private _address;
    private _cachedKeystore;
    private _autoLockMs;
    private _autoLockTimer;
    constructor(dataDir: string, network: "mainnet" | "testnet", log?: LogFn);
    /**
     * Check if a keystore file exists on disk.
     */
    isInitialized(): Promise<boolean>;
    /**
     * Check if the private key is currently in memory.
     */
    isUnlocked(): boolean;
    /**
     * Get the wallet address (from memory or cached keystore on disk).
     */
    getAddress(): Promise<string | null>;
    /**
     * Get the raw private key (32 bytes). Throws if locked.
     * Bumps the auto-lock timer on access.
     */
    getPrivateKey(): Buffer;
    /**
     * Initialize a new wallet. Generates a 24-word mnemonic, derives keys,
     * encrypts and saves the keystore. Wallet is left unlocked after init.
     *
     * @throws WalletAlreadyInitializedError if a keystore already exists
     */
    init(passphrase: string): Promise<{
        mnemonic: string;
        address: string;
        publicKey: string;
    }>;
    /**
     * Recover a wallet from a BIP39 mnemonic. Overwrites any existing keystore.
     * Wallet is left unlocked after recovery.
     *
     * @throws InvalidMnemonicError if the mnemonic is not valid BIP39
     */
    recover(mnemonic: string, passphrase: string): Promise<{
        address: string;
    }>;
    /**
     * Unlock the wallet by decrypting the keystore with the passphrase.
     *
     * @throws WalletNotInitializedError if no keystore exists
     * @throws InvalidPassphraseError if decryption fails
     */
    unlock(passphrase: string): Promise<void>;
    /**
     * Lock the wallet — zero and clear the private key from memory.
     * Also clears any auto-lock timer.
     */
    lock(): void;
    /**
     * Set the auto-lock timeout in milliseconds.
     * Set to 0 to disable auto-lock.
     */
    setAutoLockMs(ms: number): void;
    /**
     * Bump (reset) the auto-lock timer. Called on key access.
     */
    bumpAutoLock(): void;
    private clearAutoLockTimer;
    private loadKeystoreFromDisk;
    private saveKeystore;
    private decryptKeystore;
}
export {};
//# sourceMappingURL=manager.d.ts.map