/**
 * DOGE Wallet — Onboarding State Manager
 *
 * Persists onboarding progress to disk so users can resume.
 * State is per-chat, allowing multiple users to onboard.
 *
 * Much state. Very persist. Wow. 🐕
 */
import { OnboardingState, type OnboardingSession } from './types.js';
export declare class OnboardingStateManager {
    private readonly statePath;
    private readonly log;
    private store;
    constructor(dataDir: string, log?: (level: 'info' | 'warn' | 'error', msg: string) => void);
    /**
     * Get the current onboarding session for a chat.
     * Returns null if no active session or session expired.
     */
    getSession(chatId: string): Promise<OnboardingSession | null>;
    /**
     * Get the current state for a chat (convenience method).
     */
    getState(chatId: string): Promise<OnboardingState>;
    /**
     * Start a new onboarding session.
     */
    startSession(chatId: string): Promise<OnboardingSession>;
    /**
     * Update the session state.
     */
    updateSession(chatId: string, updates: Partial<Omit<OnboardingSession, 'chatId' | 'startedAt'>>): Promise<OnboardingSession | null>;
    /**
     * Transition to a new state.
     */
    transitionTo(chatId: string, newState: OnboardingState, additionalUpdates?: Partial<OnboardingSession>): Promise<OnboardingSession | null>;
    /**
     * Clear a session (completed or abandoned).
     *
     * SECURITY NOTE: JavaScript strings are immutable. The overwrite below
     * clears the reference but the original string content may persist in
     * V8 heap memory until garbage collected. The encrypted storage approach
     * mitigates disk-level exposure but doesn't eliminate in-memory risk.
     */
    clearSession(chatId: string): Promise<void>;
    /**
     * Clear all expired sessions.
     */
    cleanupExpiredSessions(): Promise<number>;
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
    setTempMnemonic(chatId: string, mnemonic: string, passphraseHash: string): Promise<void>;
    /**
     * Get the temporary mnemonic, decrypting it with the passphrase hash.
     * Used for verification and display.
     *
     * @param chatId - Chat ID
     * @param passphraseHash - The stored passphrase hash to derive decryption key
     * @returns The decrypted mnemonic, or null if not found/decryption fails
     */
    getTempMnemonic(chatId: string, passphraseHash?: string): Promise<string | null>;
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
    consumeTempMnemonic(chatId: string, passphraseHash?: string): Promise<string | null>;
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
    clearTempMnemonic(chatId: string): Promise<void>;
    /**
     * Store a hash of the passphrase for later re-verification.
     * The actual passphrase is never stored.
     *
     * Uses scrypt KDF instead of simple SHA256 for better security.
     */
    setPassphraseHash(chatId: string, passphrase: string): Promise<void>;
    /**
     * Verify a passphrase against the stored hash.
     */
    verifyPassphrase(chatId: string, passphrase: string): Promise<boolean>;
    /**
     * Get the raw passphrase hash (for mnemonic decryption).
     * Returns null if not set.
     */
    getPassphraseHash(chatId: string): Promise<string | null>;
    /**
     * Set the word indices to verify (1-based).
     */
    setVerificationWords(chatId: string, indices: number[]): Promise<void>;
    /**
     * Increment verification attempts.
     */
    incrementVerificationAttempts(chatId: string): Promise<number>;
    /**
     * Increment total verification attempts (across all rounds).
     * Returns the new total.
     */
    incrementTotalVerificationAttempts(chatId: string): Promise<number>;
    private loadStore;
    /**
     * Save the store atomically using write-to-temp + rename.
     * This prevents corruption if the process is interrupted mid-write.
     */
    private saveStore;
}
//# sourceMappingURL=state.d.ts.map