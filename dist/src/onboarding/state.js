/**
 * DOGE Wallet — Onboarding State Manager
 *
 * Persists onboarding progress to disk so users can resume.
 * State is per-chat, allowing multiple users to onboard.
 *
 * Much state. Very persist. Wow. 🐕
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scrypt, } from 'node:crypto';
import { promisify } from 'node:util';
import { OnboardingState } from './types.js';
const scryptAsync = promisify(scrypt);
// ============================================================================
// Constants
// ============================================================================
const STATE_FILENAME = 'onboarding-state.json';
const FILE_PERMS = 0o600;
const DIR_PERMS = 0o700;
// Session expires after 15 minutes of inactivity (was 1 hour - reduced for security)
const SESSION_EXPIRY_MS = 15 * 60 * 1000;
// Scrypt parameters for passphrase hashing (lighter than keystore since this is session-only)
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;
// ============================================================================
// OnboardingStateManager
// ============================================================================
export class OnboardingStateManager {
    statePath;
    log;
    store = null;
    constructor(dataDir, log) {
        this.statePath = join(dataDir, STATE_FILENAME);
        this.log = log ?? (() => { });
    }
    // --------------------------------------------------------------------------
    // Session Management
    // --------------------------------------------------------------------------
    /**
     * Get the current onboarding session for a chat.
     * Returns null if no active session or session expired.
     */
    async getSession(chatId) {
        await this.loadStore();
        const session = this.store.sessions[chatId];
        if (!session)
            return null;
        // Check expiry
        const lastUpdated = new Date(session.lastUpdated).getTime();
        if (Date.now() - lastUpdated > SESSION_EXPIRY_MS) {
            this.log('info', `doge-wallet: onboarding session expired for chat ${chatId}`);
            await this.clearSession(chatId);
            return null;
        }
        return session;
    }
    /**
     * Get the current state for a chat (convenience method).
     */
    async getState(chatId) {
        const session = await this.getSession(chatId);
        return session?.state ?? OnboardingState.NONE;
    }
    /**
     * Start a new onboarding session.
     */
    async startSession(chatId) {
        await this.loadStore();
        const session = {
            state: OnboardingState.WELCOME,
            chatId,
            startedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
        };
        this.store.sessions[chatId] = session;
        await this.saveStore();
        this.log('info', `doge-wallet: onboarding started for chat ${chatId}`);
        return session;
    }
    /**
     * Update the session state.
     */
    async updateSession(chatId, updates) {
        await this.loadStore();
        const session = this.store.sessions[chatId];
        if (!session)
            return null;
        Object.assign(session, updates, {
            lastUpdated: new Date().toISOString(),
        });
        await this.saveStore();
        return session;
    }
    /**
     * Transition to a new state.
     */
    async transitionTo(chatId, newState, additionalUpdates) {
        const updates = {
            ...additionalUpdates,
            state: newState,
        };
        const session = await this.updateSession(chatId, updates);
        if (session) {
            this.log('info', `doge-wallet: onboarding ${chatId} → ${newState}`);
        }
        return session;
    }
    /**
     * Clear a session (completed or abandoned).
     *
     * SECURITY NOTE: JavaScript strings are immutable. The overwrite below
     * clears the reference but the original string content may persist in
     * V8 heap memory until garbage collected. The encrypted storage approach
     * mitigates disk-level exposure but doesn't eliminate in-memory risk.
     */
    async clearSession(chatId) {
        await this.loadStore();
        // Securely clear any sensitive data before deletion
        const session = this.store.sessions[chatId];
        if (session) {
            if (session.tempMnemonic) {
                // Overwrite with random data before clearing (best effort)
                session.tempMnemonic = randomBytes(64).toString('hex');
            }
            if (session.tempPassphraseHash) {
                session.tempPassphraseHash = randomBytes(32).toString('hex');
            }
            if (session.encryptedMnemonic) {
                // Clear encrypted mnemonic data
                session.encryptedMnemonic.data = randomBytes(128).toString('hex');
                session.encryptedMnemonic.salt = randomBytes(16).toString('hex');
                session.encryptedMnemonic = undefined;
            }
        }
        delete this.store.sessions[chatId];
        await this.saveStore();
        this.log('info', `doge-wallet: onboarding session cleared for chat ${chatId}`);
    }
    /**
     * Clear all expired sessions.
     */
    async cleanupExpiredSessions() {
        await this.loadStore();
        const now = Date.now();
        let cleared = 0;
        for (const [chatId, session] of Object.entries(this.store.sessions)) {
            const lastUpdated = new Date(session.lastUpdated).getTime();
            if (now - lastUpdated > SESSION_EXPIRY_MS) {
                // Secure clear
                if (session.tempMnemonic) {
                    session.tempMnemonic = randomBytes(64).toString('hex');
                }
                if (session.encryptedMnemonic) {
                    session.encryptedMnemonic.data = randomBytes(128).toString('hex');
                    session.encryptedMnemonic = undefined;
                }
                delete this.store.sessions[chatId];
                cleared++;
            }
        }
        if (cleared > 0) {
            await this.saveStore();
            this.log('info', `doge-wallet: cleaned up ${cleared} expired onboarding sessions`);
        }
        return cleared;
    }
    // --------------------------------------------------------------------------
    // Mnemonic Handling (encrypted temporary storage)
    // --------------------------------------------------------------------------
    /**
     * Store the mnemonic temporarily during onboarding, encrypted at rest.
     * This is cleared after successful verification.
     *
     * SECURITY: The mnemonic is encrypted using AES-256-GCM with a key derived
     * from the passphrase hash via scrypt. This prevents plaintext exposure
     * if the state file is compromised.
     *
     * SECURITY NOTE: JavaScript strings are immutable. This overwrites the
     * reference but the original string content may persist in V8 heap memory
     * until garbage collected. For maximum security, consider keeping mnemonics
     * only in memory (not persisted) at the cost of losing progress on restart.
     *
     * The encrypted storage approach mitigates disk-level exposure but doesn't
     * eliminate in-memory risk.
     *
     * @param chatId - Chat ID
     * @param mnemonic - The 24-word mnemonic to store
     * @param passphraseHash - The stored passphrase hash (salt:derivedKey format)
     */
    async setTempMnemonic(chatId, mnemonic, passphraseHash) {
        // Derive encryption key from passphrase hash
        const salt = randomBytes(16);
        const key = await scryptAsync(passphraseHash, salt, 32);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(mnemonic, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        const encryptedMnemonic = {
            salt: salt.toString('hex'),
            iv: iv.toString('hex'),
            tag: tag.toString('hex'),
            data: encrypted,
        };
        await this.updateSession(chatId, {
            encryptedMnemonic,
            tempMnemonic: undefined, // Clear any legacy plaintext mnemonic
        });
    }
    /**
     * Get the temporary mnemonic, decrypting it with the passphrase hash.
     * Used for verification and display.
     *
     * @param chatId - Chat ID
     * @param passphraseHash - The stored passphrase hash to derive decryption key
     * @returns The decrypted mnemonic, or null if not found/decryption fails
     */
    async getTempMnemonic(chatId, passphraseHash) {
        const session = await this.getSession(chatId);
        if (!session)
            return null;
        // Handle encrypted mnemonic (new secure format)
        if (session.encryptedMnemonic && passphraseHash) {
            try {
                const { salt, iv, tag, data } = session.encryptedMnemonic;
                const key = await scryptAsync(passphraseHash, Buffer.from(salt, 'hex'), 32);
                const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
                decipher.setAuthTag(Buffer.from(tag, 'hex'));
                let decrypted = decipher.update(data, 'hex', 'utf8');
                decrypted += decipher.final('utf8');
                return decrypted;
            }
            catch (err) {
                this.log('warn', `doge-wallet: failed to decrypt mnemonic for chat ${chatId}`);
                return null;
            }
        }
        // Fallback to legacy plaintext mnemonic (for migration)
        return session.tempMnemonic ?? null;
    }
    /**
     * Get and clear the temporary mnemonic.
     *
     * SECURITY NOTE: JavaScript strings are immutable. This overwrites the
     * reference but the original string content may persist in V8 heap memory
     * until garbage collected. For maximum security, consider keeping mnemonics
     * only in memory (not persisted) at the cost of losing progress on restart.
     *
     * The encrypted storage approach mitigates disk-level exposure but doesn't
     * eliminate in-memory risk.
     */
    async consumeTempMnemonic(chatId, passphraseHash) {
        const mnemonic = await this.getTempMnemonic(chatId, passphraseHash);
        if (!mnemonic)
            return null;
        // Clear it immediately
        await this.clearTempMnemonic(chatId);
        return mnemonic;
    }
    /**
     * Attempts to clear the mnemonic from the session.
     *
     * SECURITY NOTE: JavaScript strings are immutable. This overwrites the
     * reference but the original string content may persist in V8 heap memory
     * until garbage collected. For maximum security, consider keeping mnemonics
     * only in memory (not persisted) at the cost of losing progress on restart.
     *
     * The encrypted storage approach mitigates disk-level exposure but doesn't
     * eliminate in-memory risk.
     */
    async clearTempMnemonic(chatId) {
        const session = await this.getSession(chatId);
        if (!session)
            return;
        // Overwrite encrypted mnemonic with random data before clearing
        if (session.encryptedMnemonic) {
            session.encryptedMnemonic.data = randomBytes(128).toString('hex');
            session.encryptedMnemonic.salt = randomBytes(16).toString('hex');
        }
        // Overwrite legacy plaintext mnemonic
        if (session.tempMnemonic) {
            session.tempMnemonic = randomBytes(64).toString('hex');
        }
        await this.updateSession(chatId, {
            encryptedMnemonic: undefined,
            tempMnemonic: undefined,
        });
    }
    // --------------------------------------------------------------------------
    // Passphrase Hash (for re-verification) - Using proper KDF
    // --------------------------------------------------------------------------
    /**
     * Store a hash of the passphrase for later re-verification.
     * The actual passphrase is never stored.
     *
     * Uses scrypt KDF instead of simple SHA256 for better security.
     */
    async setPassphraseHash(chatId, passphrase) {
        const salt = randomBytes(16);
        // Note: Node.js scrypt with promisify uses positional args (password, salt, keylen)
        // Options like N/r/p use the Node.js crypto.scryptSync options format
        const derived = await new Promise((resolve, reject) => {
            scrypt(passphrase, salt, SCRYPT_DKLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
                if (err)
                    reject(err);
                else
                    resolve(key);
            });
        });
        // Store as salt:hash format
        const hash = salt.toString('hex') + ':' + derived.toString('hex');
        await this.updateSession(chatId, { tempPassphraseHash: hash });
    }
    /**
     * Verify a passphrase against the stored hash.
     */
    async verifyPassphrase(chatId, passphrase) {
        const session = await this.getSession(chatId);
        if (!session?.tempPassphraseHash)
            return false;
        // Handle new scrypt format (salt:hash)
        if (session.tempPassphraseHash.includes(':')) {
            const [saltHex, storedHash] = session.tempPassphraseHash.split(':');
            const salt = Buffer.from(saltHex, 'hex');
            const derived = await new Promise((resolve, reject) => {
                scrypt(passphrase, salt, SCRYPT_DKLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
                    if (err)
                        reject(err);
                    else
                        resolve(key);
                });
            });
            return derived.toString('hex') === storedHash;
        }
        // Legacy SHA256 format (for migration)
        const legacyHash = createHash('sha256')
            .update(passphrase)
            .update(chatId)
            .digest('hex');
        return legacyHash === session.tempPassphraseHash;
    }
    /**
     * Get the raw passphrase hash (for mnemonic decryption).
     * Returns null if not set.
     */
    async getPassphraseHash(chatId) {
        const session = await this.getSession(chatId);
        return session?.tempPassphraseHash ?? null;
    }
    // --------------------------------------------------------------------------
    // Verification Words
    // --------------------------------------------------------------------------
    /**
     * Set the word indices to verify (1-based).
     */
    async setVerificationWords(chatId, indices) {
        await this.updateSession(chatId, {
            verificationWords: indices,
            verificationAttempts: 0,
        });
    }
    /**
     * Increment verification attempts.
     */
    async incrementVerificationAttempts(chatId) {
        const session = await this.getSession(chatId);
        const attempts = (session?.verificationAttempts ?? 0) + 1;
        await this.updateSession(chatId, { verificationAttempts: attempts });
        return attempts;
    }
    /**
     * Increment total verification attempts (across all rounds).
     * Returns the new total.
     */
    async incrementTotalVerificationAttempts(chatId) {
        const session = await this.getSession(chatId);
        const totalAttempts = (session?.totalVerificationAttempts ?? 0) + 1;
        await this.updateSession(chatId, { totalVerificationAttempts: totalAttempts });
        return totalAttempts;
    }
    // --------------------------------------------------------------------------
    // Persistence (Atomic File Writes)
    // --------------------------------------------------------------------------
    async loadStore() {
        if (this.store)
            return;
        try {
            const raw = await readFile(this.statePath, 'utf-8');
            this.store = JSON.parse(raw);
        }
        catch (err) {
            const e = err;
            if (e.code === 'ENOENT') {
                // No state file yet — create empty store
                this.store = { version: 1, sessions: {} };
            }
            else {
                this.log('warn', `doge-wallet: failed to load onboarding state: ${e.message}`);
                this.store = { version: 1, sessions: {} };
            }
        }
    }
    /**
     * Save the store atomically using write-to-temp + rename.
     * This prevents corruption if the process is interrupted mid-write.
     */
    async saveStore() {
        if (!this.store)
            return;
        const dir = dirname(this.statePath);
        await mkdir(dir, { recursive: true, mode: DIR_PERMS });
        const json = JSON.stringify(this.store, null, 2);
        const tempPath = this.statePath + '.tmp';
        // Write to temp file first
        await writeFile(tempPath, json, { encoding: 'utf-8', mode: FILE_PERMS });
        // Atomic rename (POSIX guarantees atomicity for rename within same filesystem)
        await rename(tempPath, this.statePath);
    }
}
//# sourceMappingURL=state.js.map