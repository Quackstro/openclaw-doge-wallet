/**
 * DOGE Wallet — Passphrase Strength Validator
 *
 * Validates passphrase strength for wallet encryption.
 * Checks length, character variety, and common passwords.
 *
 * Much entropy. Very secure. Wow. 🐕
 */
// ============================================================================
// Common Passwords (Top 100 most common)
// ============================================================================
const COMMON_PASSWORDS = new Set([
    'password', 'password123', 'password1', '123456', '123456789', '12345678',
    'qwerty', 'abc123', 'monkey', '1234567', 'letmein', 'trustno1', 'dragon',
    'baseball', 'iloveyou', 'master', 'sunshine', 'ashley', 'bailey', 'shadow',
    'passw0rd', '123123', '654321', 'superman', 'qazwsx', 'michael', 'football',
    'password1', 'password12', 'princess', 'azerty', 'admin', 'login', 'welcome',
    'solo', 'master123', 'hello', 'charlie', 'donald', 'lovely', 'starwars',
    'whatever', 'qwerty123', '666666', '121212', 'flower', 'hottie', 'loveme',
    '696969', 'mustang', 'letmein1', 'michael1', 'jordan', 'access', 'ranger',
    'buster', 'thomas', 'tigger', 'robert', 'soccer', 'fuckyou', 'batman',
    'test', 'killer', 'hockey', 'george', 'charlie1', 'andrew', 'michelle',
    'jennifer', 'joshua', 'daniel', 'summer', 'hannah', 'pepper', 'ginger',
    'freedom', 'computer', 'thunder', 'taylor', 'diamond', '111111', '000000',
    '7777777', 'qwerty12', 'asdfgh', 'zxcvbn', 'zxcvbnm', 'qwertyuiop',
    'dogecoin', 'bitcoin', 'crypto', 'wallet', 'doge', 'tothemoon', 'moon',
    'muchsecure', 'verysecure', 'suchwow', 'shibainu', 'shiba', 'elon', 'musk',
]);
/**
 * Common dictionary words that significantly reduce effective entropy
 * when used as part of a passphrase. This is a subset of the most
 * commonly used words in passwords.
 */
const COMMON_DICTIONARY_WORDS = [
    'love', 'hate', 'home', 'pass', 'word', 'user', 'name', 'code',
    'secure', 'secret', 'private', 'public', 'open', 'close', 'lock',
    'key', 'door', 'safe', 'bank', 'money', 'cash', 'gold', 'coin',
    'doge', 'moon', 'rocket', 'diamond', 'hands', 'hold', 'hodl',
    'crypto', 'bitcoin', 'wallet', 'account', 'login', 'admin',
];
// Common patterns to check
const COMMON_PATTERNS = [
    /^(.)\1+$/, // All same character: aaaaaaa
    /^123456/, // Starts with 123456
    /^abcdef/i, // Starts with abcdef
    /^qwerty/i, // Starts with qwerty
    /password/i, // Contains "password"
    /^[a-z]+$/i, // All letters only
    /^[0-9]+$/, // All numbers only
    /^[a-z]+[0-9]+$/i, // Simple word + numbers
    /^[0-9]+[a-z]+$/i, // Numbers + simple word
];
// ============================================================================
// Entropy Calculation
// ============================================================================
/**
 * Calculate password entropy in bits.
 * Uses character set size × log2(length)
 */
function calculateEntropy(passphrase) {
    let charsetSize = 0;
    if (/[a-z]/.test(passphrase))
        charsetSize += 26;
    if (/[A-Z]/.test(passphrase))
        charsetSize += 26;
    if (/[0-9]/.test(passphrase))
        charsetSize += 10;
    if (/[^a-zA-Z0-9]/.test(passphrase))
        charsetSize += 32; // Special chars
    if (charsetSize === 0)
        return 0;
    // entropy = log2(charsetSize^length) = length * log2(charsetSize)
    return passphrase.length * Math.log2(charsetSize);
}
/**
 * Score based on entropy.
 * - < 40 bits: weak (easily crackable)
 * - 40-60 bits: medium (reasonable)
 * - > 60 bits: strong (good)
 */
function entropyToScore(entropy) {
    if (entropy < 40)
        return 'weak';
    if (entropy < 60)
        return 'medium';
    return 'strong';
}
/**
 * Check if the passphrase contains common dictionary words.
 * Returns true if any common word is found, reducing effective entropy.
 */
function containsCommonWords(passphrase) {
    const lower = passphrase.toLowerCase();
    return COMMON_DICTIONARY_WORDS.some(word => lower.includes(word));
}
// ============================================================================
// Main Validation Function
// ============================================================================
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
export function validatePassphrase(passphrase) {
    const issues = [];
    let valid = true;
    // 1. Minimum length check
    if (passphrase.length < 12) {
        issues.push(`Too short — need at least 12 characters (you have ${passphrase.length})`);
        valid = false;
    }
    else if (passphrase.length < 16) {
        issues.push('Consider making it longer — 16+ characters is better');
    }
    // 2. Common password check
    const lower = passphrase.toLowerCase();
    if (COMMON_PASSWORDS.has(lower)) {
        issues.push('This is a very common password — please choose something unique');
        valid = false;
    }
    // 3. Common pattern check
    for (const pattern of COMMON_PATTERNS) {
        if (pattern.test(passphrase)) {
            issues.push('Uses a predictable pattern — try mixing it up');
            valid = false;
            break;
        }
    }
    // 4. Character variety check
    const hasLower = /[a-z]/.test(passphrase);
    const hasUpper = /[A-Z]/.test(passphrase);
    const hasDigit = /[0-9]/.test(passphrase);
    const hasSpecial = /[^a-zA-Z0-9]/.test(passphrase);
    const varietyCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
    if (varietyCount < 2) {
        issues.push('Add variety — mix letters, numbers, and symbols');
    }
    else if (varietyCount === 2 && passphrase.length < 16) {
        issues.push('Consider adding numbers or symbols for extra strength');
    }
    // 5. Calculate entropy
    let entropy = calculateEntropy(passphrase);
    // 5a. Apply dictionary penalty - common words reduce effective entropy
    if (containsCommonWords(passphrase)) {
        entropy = Math.floor(entropy * 0.5); // Halve effective entropy
        issues.push('Contains common words/patterns');
    }
    // 6. Determine overall score
    let score;
    if (!valid || entropy < 40) {
        score = 'weak';
    }
    else if (entropy < 60 || varietyCount < 3) {
        score = 'medium';
    }
    else {
        score = 'strong';
    }
    // 7. Keyboard walk detection (qwerty, asdfgh, zxcvbn)
    const keyboardWalks = ['qwerty', 'asdfgh', 'zxcvbn', '12345', '09876'];
    for (const walk of keyboardWalks) {
        if (lower.includes(walk)) {
            issues.push('Contains keyboard pattern — try something more random');
            if (score === 'strong')
                score = 'medium';
            break;
        }
    }
    // 8. Repeated character check
    if (/(.)\1{3,}/.test(passphrase)) {
        issues.push('Avoid repeated characters (aaaa, 1111)');
        if (score === 'strong')
            score = 'medium';
    }
    return {
        valid,
        score,
        issues,
        entropy: Math.round(entropy),
    };
}
/**
 * Get a human-friendly strength description.
 */
export function getStrengthDescription(strength) {
    switch (strength.score) {
        case 'strong':
            return '💪 Strong passphrase';
        case 'medium':
            return '😐 Okay passphrase — could be stronger';
        case 'weak':
            return '⚠️ Weak passphrase — not recommended for real money';
    }
}
/**
 * Get a suggested passphrase pattern (not an actual passphrase).
 */
export function getSuggestionTip() {
    return '💡 Tip: Use 3-4 random words with numbers/symbols, like:\n' +
        '   purple-tiger-42-jumping\n' +
        '   correct.horse.battery.staple\n' +
        '   MuchSecure!Very2024Wow';
}
//# sourceMappingURL=passphrase-validator.js.map