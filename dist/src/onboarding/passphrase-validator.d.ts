/**
 * DOGE Wallet — Passphrase Strength Validator
 *
 * Validates passphrase strength for wallet encryption.
 * Checks length, character variety, and common passwords.
 *
 * Much entropy. Very secure. Wow. 🐕
 */
import type { PassphraseStrength } from './types.js';
/**
 * Validate passphrase strength.
 *
 * Requirements:
 * - Minimum 12 characters (for real money)
 * - Not in common password list
 * - Reasonable entropy (character variety)
 * - Not a trivial pattern
 *
 * @param passphrase - The passphrase to validate
 * @returns PassphraseStrength with validity, score, and issues
 */
export declare function validatePassphrase(passphrase: string): PassphraseStrength;
/**
 * Get a human-friendly strength description.
 */
export declare function getStrengthDescription(strength: PassphraseStrength): string;
/**
 * Get a suggested passphrase pattern (not an actual passphrase).
 */
export declare function getSuggestionTip(): string;
//# sourceMappingURL=passphrase-validator.d.ts.map