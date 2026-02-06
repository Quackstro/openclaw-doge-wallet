# Security Policy

## Responsible Disclosure

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT open a public GitHub issue.**
2. Email security concerns to the maintainers (see `package.json` author).
3. Include: description, reproduction steps, potential impact, and suggested fix if possible.
4. We aim to acknowledge reports within 48 hours and provide a fix within 7 days for critical issues.

## Security Architecture

### Key Material Lifecycle

```
Generate Mnemonic (BIP39, 24 words)
    ↓
Derive Seed (PBKDF2, 2048 rounds)
    ↓
Derive HD Key (BIP44: m/44'/3'/0'/0/0)
    ↓
Encrypt Private Key (AES-256-GCM + scrypt KDF)
    ↓
Write to Disk (atomic write, 0600 perms)
    ↓
[Lock/Unlock cycle — key in memory only when unlocked]
    ↓
Zero on Lock (Buffer.fill(0))
```

### Encryption Parameters
- **KDF:** scrypt with N=131072, r=8, p=1 (~1s derivation)
- **Cipher:** AES-256-GCM (authenticated encryption)
- **Key length:** 256 bits (dklen=32)
- **IV:** 12 random bytes per encryption (GCM standard)
- **Salt:** 32 random bytes per keystore

### Spending Policy Engine
Transactions are evaluated against configurable tiers:

| Tier | Default Threshold | Action |
|------|-------------------|--------|
| Micro | ≤ 10 DOGE | Auto-approve (logged) |
| Small | ≤ 100 DOGE | Auto-approve (logged) |
| Medium | ≤ 1,000 DOGE | Notify + 5-min delay |
| Large | ≤ 10,000 DOGE | Owner approval required |
| Sweep | Unlimited | Owner confirmation code required |

### Authentication
- Approval/deny operations verify caller identity against the configured wallet owner
- Approval IDs are UUIDs (128-bit entropy)
- Auto-timeout approvals are system-initiated and bypass caller checks

### File Security
- All sensitive files written with `0600` permissions
- Directories with `0700` permissions
- Atomic writes (temp file + rename) prevent corruption
- Keystore cached in memory after first read

## Threat Model

### In Scope
| Threat | Mitigation |
|--------|------------|
| **Memory dump / cold boot attack** | Keys zeroed after use; scrypt makes brute force expensive |
| **Disk access by attacker** | AES-256-GCM encryption; strict file permissions |
| **Prompt injection** | Owner identity verification on approvals; spending policy tiers |
| **API token leakage** | HTTPS enforced; tokens stripped from error messages |
| **Double-spend (self)** | Atomic UTXO select-and-lock; mutex protection |
| **Invoice replay** | Already-settled invoice check in verification |
| **Brute-force passphrase** | scrypt KDF (~1s/attempt); rate limiting (5/min) |

### Out of Scope / Accepted Risk
| Risk | Notes |
|------|-------|
| **Compromised host OS** | If attacker has root, all bets are off |
| **Supply chain attack** | Dependencies (bip39, hdkey, bitcore-lib-doge) are trusted but not vendored |
| **V8 heap inspection** | Node.js internals may retain copies of key material |

## Telegram Message Security

### Auto-Deletion of Sensitive Messages
The plugin automatically deletes user messages that contain sensitive data:
- `/wallet unlock <passphrase>` — deleted immediately after processing
- `/wallet recover <mnemonic>` — deleted immediately after processing  
- `/wallet export <passphrase>` — deleted immediately after processing
- Onboarding passphrase input — deleted immediately after processing

### Manual Deletion Guidance
⚠️ **Telegram bot messages are NOT end-to-end encrypted.** Users should be aware:

1. **Auto-delete may fail** — If the bot lacks `deleteMessage` permission or Telegram's API is slow, the message may persist briefly. The bot will warn you if deletion fails.
2. **Bot responses** containing addresses or transaction details remain in chat history. These are not secret, but review periodically.
3. **Telegram servers** retain message history. For large holdings, consider a hardware wallet.
4. **Screenshots/notifications** — Telegram may show message previews in OS notifications before deletion. Disable notification previews for sensitive chats.
5. **Telegram Desktop** may cache messages locally even after server deletion.

**Best practices:**
- Use Telegram's "Secret Chat" feature where possible (not available for bots)
- Enable Telegram's auto-delete timer on the bot chat (e.g., 1 week)
- Periodically clear chat history with the bot
- For large amounts, use a dedicated hardware wallet

## Known Limitations

### C-2: JavaScript String Mnemonic (Inherent)
**Severity:** Critical (architectural)  
**Status:** Documented, partially mitigated

The BIP39 mnemonic is returned as a JavaScript string, which is **immutable and cannot be zeroed from memory**. It persists in the V8 heap until garbage-collected, and may remain in physical memory even after GC.

**Mitigations applied:**
- `global.gc?.()` hint after wallet init
- Documentation instructing callers to null references ASAP
- Mnemonic shown only once during onboarding

**Recommendations for operators:**
- Run on encrypted swap
- Use encrypted disk
- Minimize the wallet init → mnemonic display → user confirmation window
- On VPS: be aware the hosting provider has physical memory access

### L-3: Flat Rate Limiting
Unlock attempts are rate-limited at 5/minute (flat). For weak passphrases, this may be insufficient over extended periods. The scrypt KDF provides the primary brute-force protection (~1s per attempt).

### L-4: Audit Log Integrity
The audit log is a plain JSONL file with no hash chain or tamper detection. An attacker with file access could modify entries.

### M-2: OP_RETURN Parsing
Manual hex parsing of OP_RETURN scripts may fail for payloads ≥76 bytes (different push data encoding). OP_RETURN verification is advisory, not required for payment acceptance.
