/**
 * DOGE Wallet — Key Manager
 *
 * Manages wallet lifecycle: init, recover, lock, unlock, auto-lock.
 * Keys are encrypted at rest with AES-256-GCM (scrypt KDF).
 * Private keys are held in memory only while unlocked and zeroed on lock.
 *
 * Much secure. Very encrypt. Wow. 🐕
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as bip39 from "bip39";
import { deriveKeyPair } from "./derivation.js";
import { WalletAlreadyInitializedError, WalletLockedError, WalletNotInitializedError, InvalidPassphraseError, InvalidMnemonicError, } from "../errors.js";
// Scrypt parameters (secure defaults — matches Ethereum keystore v3)
const SCRYPT_N = 2 ** 15; // 32768 — good security/speed tradeoff for wallet use
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;
// maxmem for scryptSync: N * r * 128 * 2 (safety margin)
const SCRYPT_MAXMEM = 128 * 1024 * 1024;
export class WalletManager {
    dataDir;
    network;
    keystoreDir;
    keystorePath;
    log;
    _privateKey = null;
    _address = null;
    _cachedKeystore = null;
    // Auto-lock
    _autoLockMs = 0;
    _autoLockTimer = null;
    constructor(dataDir, network, log) {
        this.dataDir = dataDir;
        this.network = network;
        this.keystoreDir = join(dataDir, "keys");
        this.keystorePath = join(this.keystoreDir, "wallet.json");
        this.log = log ?? (() => { });
    }
    /**
     * Check if a keystore file exists on disk.
     */
    async isInitialized() {
        return existsSync(this.keystorePath);
    }
    /**
     * Check if the private key is currently in memory.
     */
    isUnlocked() {
        return this._privateKey !== null;
    }
    /**
     * Get the wallet address (from memory or cached keystore on disk).
     */
    async getAddress() {
        if (this._address)
            return this._address;
        // Try to read from keystore on disk
        const ks = this.loadKeystoreFromDisk();
        if (ks) {
            this._address = ks.address;
            return ks.address;
        }
        return null;
    }
    /**
     * Get the raw private key (32 bytes). Throws if locked.
     * Bumps the auto-lock timer on access.
     */
    getPrivateKey() {
        if (!this._privateKey) {
            throw new WalletLockedError();
        }
        this.bumpAutoLock();
        // Return a copy so the caller can zero it independently
        return Buffer.from(this._privateKey);
    }
    /**
     * Initialize a new wallet. Generates a 24-word mnemonic, derives keys,
     * encrypts and saves the keystore. Wallet is left unlocked after init.
     *
     * @throws WalletAlreadyInitializedError if a keystore already exists
     */
    async init(passphrase) {
        if (await this.isInitialized()) {
            throw new WalletAlreadyInitializedError();
        }
        // Generate 24-word mnemonic (256 bits of entropy)
        const mnemonic = bip39.generateMnemonic(256);
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const keyPair = deriveKeyPair(seed, this.network);
        // Encrypt and save
        this.saveKeystore(passphrase, {
            mnemonic,
            privateKey: keyPair.privateKey.toString("hex"),
            address: keyPair.address,
        });
        // Keep unlocked in memory
        this._privateKey = keyPair.privateKey;
        this._address = keyPair.address;
        this.log("info", `doge-wallet: wallet initialized, address=${keyPair.address}`);
        return { mnemonic, address: keyPair.address, publicKey: keyPair.publicKey };
    }
    /**
     * Recover a wallet from a BIP39 mnemonic. Overwrites any existing keystore.
     * Wallet is left unlocked after recovery.
     *
     * @throws InvalidMnemonicError if the mnemonic is not valid BIP39
     */
    async recover(mnemonic, passphrase) {
        const normalized = mnemonic.trim().toLowerCase();
        if (!bip39.validateMnemonic(normalized)) {
            throw new InvalidMnemonicError();
        }
        const seed = bip39.mnemonicToSeedSync(normalized);
        const keyPair = deriveKeyPair(seed, this.network);
        // Encrypt and save (overwrites existing)
        this.saveKeystore(passphrase, {
            mnemonic: normalized,
            privateKey: keyPair.privateKey.toString("hex"),
            address: keyPair.address,
        });
        // Keep unlocked in memory
        this._privateKey = keyPair.privateKey;
        this._address = keyPair.address;
        this.log("info", `doge-wallet: wallet recovered, address=${keyPair.address}`);
        return { address: keyPair.address };
    }
    /**
     * Unlock the wallet by decrypting the keystore with the passphrase.
     *
     * @throws WalletNotInitializedError if no keystore exists
     * @throws InvalidPassphraseError if decryption fails
     */
    async unlock(passphrase) {
        const ks = this.loadKeystoreFromDisk();
        if (!ks) {
            throw new WalletNotInitializedError();
        }
        const payload = this.decryptKeystore(ks, passphrase);
        this._privateKey = Buffer.from(payload.privateKey, "hex");
        this._address = payload.address;
        this.log("info", "doge-wallet: wallet unlocked");
    }
    /**
     * Lock the wallet — zero and clear the private key from memory.
     * Also clears any auto-lock timer.
     */
    lock() {
        if (this._privateKey) {
            this._privateKey.fill(0);
            this._privateKey = null;
        }
        this.clearAutoLockTimer();
    }
    /**
     * Set the auto-lock timeout in milliseconds.
     * Set to 0 to disable auto-lock.
     */
    setAutoLockMs(ms) {
        this._autoLockMs = ms;
        if (ms <= 0) {
            this.clearAutoLockTimer();
        }
    }
    /**
     * Bump (reset) the auto-lock timer. Called on key access.
     */
    bumpAutoLock() {
        this.clearAutoLockTimer();
        if (this._autoLockMs > 0 && this._privateKey) {
            this._autoLockTimer = setTimeout(() => {
                this.log("info", "doge-wallet: auto-lock triggered");
                this.lock();
            }, this._autoLockMs);
            // Don't keep the process alive just for auto-lock
            if (this._autoLockTimer.unref) {
                this._autoLockTimer.unref();
            }
        }
    }
    // ---- Private helpers ----
    clearAutoLockTimer() {
        if (this._autoLockTimer) {
            clearTimeout(this._autoLockTimer);
            this._autoLockTimer = null;
        }
    }
    loadKeystoreFromDisk() {
        if (this._cachedKeystore)
            return this._cachedKeystore;
        try {
            const raw = readFileSync(this.keystorePath, "utf-8");
            this._cachedKeystore = JSON.parse(raw);
            return this._cachedKeystore;
        }
        catch {
            return null;
        }
    }
    saveKeystore(passphrase, payload) {
        // Ensure keys directory exists with secure permissions
        mkdirSync(this.keystoreDir, { recursive: true, mode: 0o700 });
        const salt = randomBytes(32);
        const iv = randomBytes(16);
        // Derive encryption key with scrypt
        const key = scryptSync(passphrase, salt, SCRYPT_DKLEN, {
            N: SCRYPT_N,
            r: SCRYPT_R,
            p: SCRYPT_P,
            maxmem: SCRYPT_MAXMEM,
        });
        // Encrypt with AES-256-GCM
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        const plaintext = JSON.stringify(payload);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, "utf-8"),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        const keystore = {
            version: 1,
            crypto: {
                cipher: "aes-256-gcm",
                ciphertext: encrypted.toString("hex"),
                iv: iv.toString("hex"),
                tag: tag.toString("hex"),
                kdf: "scrypt",
                kdfparams: {
                    n: SCRYPT_N,
                    r: SCRYPT_R,
                    p: SCRYPT_P,
                    salt: salt.toString("hex"),
                    dklen: SCRYPT_DKLEN,
                },
            },
            address: payload.address,
            network: this.network,
        };
        writeFileSync(this.keystorePath, JSON.stringify(keystore, null, 2), {
            mode: 0o600,
        });
        // Update cache
        this._cachedKeystore = keystore;
    }
    decryptKeystore(ks, passphrase) {
        const { crypto: c } = ks;
        const salt = Buffer.from(c.kdfparams.salt, "hex");
        const iv = Buffer.from(c.iv, "hex");
        const tag = Buffer.from(c.tag, "hex");
        const ciphertext = Buffer.from(c.ciphertext, "hex");
        // Derive key with same scrypt params
        const key = scryptSync(passphrase, salt, c.kdfparams.dklen, {
            N: c.kdfparams.n,
            r: c.kdfparams.r,
            p: c.kdfparams.p,
            maxmem: SCRYPT_MAXMEM,
        });
        try {
            const decipher = createDecipheriv("aes-256-gcm", key, iv);
            decipher.setAuthTag(tag);
            const decrypted = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]);
            return JSON.parse(decrypted.toString("utf-8"));
        }
        catch {
            // Clear cached keystore so next attempt re-reads from disk
            this._cachedKeystore = null;
            throw new InvalidPassphraseError();
        }
    }
}
//# sourceMappingURL=manager.js.map