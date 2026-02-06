# DOGE Wallet Plugin — Security Code Review

**Reviewed:** 2026-02-06  
**Scope:** All 51 TypeScript source files (~13,625 lines) in `/home/clawdbot/.openclaw/extensions/doge-wallet/src/`  
**Reviewer:** Claude Opus 4.6 (`anthropic/claude-opus-4-6`) — automated security audit  
**Network:** Mainnet (real money)

---

## Executive Summary

The DOGE wallet plugin is **well-architected with solid security fundamentals**. Key material is handled carefully (scrypt KDF, AES-256-GCM, zeroing after use), file permissions are enforced, SSRF protections exist, and the policy engine is reasonably robust. However, several issues were found, including **2 critical**, **4 high**, **6 medium**, **8 low**, and **5 informational** findings.

---

## CRITICAL

### C-1: Private Key Returned by Reference — Caller Can Corrupt Live Key
**File:** `src/keys/manager.ts`, line ~258  
**Description:** `getPrivateKey()` returns the internal `this._privateKey` buffer directly. Any caller that modifies or zeros this buffer corrupts the wallet's signing capability until re-unlock.  
**Exploitation:** If any code path (e.g., signer, bitcore internals) mutates the returned buffer, subsequent transactions silently fail or produce invalid signatures, potentially causing fund loss if a partially-signed tx is somehow broadcast.  
**Recommended Fix:** Return `Buffer.from(this._privateKey)` (a copy) and let the caller zero their copy.

### C-2: Mnemonic Exposed as JavaScript String — Cannot Be Zeroed
**File:** `src/keys/manager.ts`, lines ~113-120; `src/keys/derivation.ts`, line ~46  
**Description:** `generateMnemonic()` returns a JS string (immutable). `WalletManager.init()` returns it in `WalletInitResult.mnemonic`. JavaScript strings **cannot be zeroed from memory** — they persist in V8 heap until GC collects them, and even then may remain in physical memory.  
**Exploitation:** A memory dump (core dump, swap file, /proc/mem, cold boot attack) could recover the mnemonic long after it was "used." On a VPS, the hosting provider has physical access.  
**Recommended Fix:** This is an inherent limitation of JavaScript. Document it prominently. Consider: (1) Using Buffer for mnemonic handling internally and converting to string only at the final display moment, (2) Triggering a manual GC hint after display (`global.gc?.()` if exposed), (3) Recommending the user run on encrypted swap. The code already has good security notes about this — but the architectural limitation remains critical for a mainnet wallet.

---

## HIGH

### H-1: `signTransaction` Does Not Zero the Input `privateKey` Buffer
**File:** `src/tx/signer.ts`, lines ~77-167  
**Description:** The signer creates a bitcore `PrivateKey` from the raw buffer and attempts to zero the bitcore BN internals in the `finally` block. However, the **original `privateKey` Buffer parameter** is never zeroed by the signer. This is the caller's responsibility, but `WalletManager.getPrivateKey()` returns the live internal buffer (see C-1), so there's no safe copy to zero.  
**Exploitation:** Combined with C-1, the private key buffer persists in memory indefinitely.  
**Recommended Fix:** Have the signer make its own copy, use it, then zero it. The caller should also zero any copies they hold.

### H-2: Passphrase Stored In-Memory as JavaScript String During Onboarding
**File:** `src/onboarding/flow.ts`, lines ~96-120  
**Description:** `tempPassphrases` Map stores raw passphrases as JS strings. While there's a 5-minute expiry and periodic cleanup, the string values **cannot be zeroed** from V8 memory even after `Map.delete()`.  
**Exploitation:** Memory dump during the onboarding window reveals the passphrase.  
**Recommended Fix:** Store as Buffer (or encrypted in memory with a session-ephemeral key). Acknowledge that perfection is impossible in JS but minimize exposure.

### H-3: No Authentication on Approval/Deny Operations
**File:** `src/policy/approval.ts`, lines ~143-170  
**Description:** `approve(id, by)` and `deny(id, by)` accept any caller-provided `by` string. There's no verification that the caller is actually the wallet owner. The approval ID is a UUID, providing some obscurity, but if an attacker learns the ID (e.g., from logs, Telegram messages), they can approve arbitrary transactions.  
**Exploitation:** An agent that has been prompt-injected, or a compromised plugin, could call `approve()` on pending high-value transactions by guessing or reading the approval ID from the notification message.  
**Recommended Fix:** Require a cryptographic proof of identity (e.g., HMAC of the approval ID with a secret) or require the approval to come through the same authenticated channel as the notification.

### H-4: BlockCypher API Token Sent as URL Query Parameter
**File:** `src/api/blockcypher.ts`, line ~88  
**Description:** `url.searchParams.set("token", this.apiToken)` puts the API token in the URL. URLs are logged in web servers, proxy logs, browser history, and potentially in error messages.  
**Exploitation:** API token leak via logs, referer headers, or error messages could allow an attacker to consume the API quota or, if the token has write permissions, to submit malicious requests.  
**Recommended Fix:** Use an `Authorization` header instead if BlockCypher supports it. If not, document the risk and ensure error messages don't include the full URL. (Note: BlockCypher's API design requires query params, so this may be unavoidable — but ensure the token never appears in logs.)

---

## MEDIUM

### M-1: Race Condition in UTXO Locking Between Selection and Broadcast
**File:** `src/utxo/manager.ts` and `src/tx/builder.ts`  
**Description:** Coin selection reads UTXOs, then the caller builds and broadcasts the transaction. Between selection and the `markSpent()` call, another concurrent send could select the same UTXOs. The `utxoMutex` protects individual operations but there's no transaction-level lock spanning selection → build → sign → broadcast → markSpent.  
**Exploitation:** Two concurrent send requests could select the same UTXOs, leading to one transaction failing at broadcast (double-spend rejection). No fund loss, but denial-of-service for the second transaction and potential confusion.  
**Recommended Fix:** Implement an atomic "select-and-lock" operation that holds the mutex across the entire selection, or lock UTXOs optimistically at selection time and unlock on broadcast failure.

### M-2: OP_RETURN Parsing Assumes Fixed-Length Prefix
**File:** `src/a2a/verification.ts`, lines ~189-200  
**Description:** `checkOpReturn` parses the script by skipping 4 hex chars (`script.slice(4)`), assuming a single-byte push data length. If the OP_RETURN data is ≥76 bytes, Bitcoin uses `OP_PUSHDATA1` (2-byte prefix), and this parsing breaks silently, returning false.  
**Exploitation:** An attacker could craft a payment with a technically valid OP_RETURN that doesn't match because of a different script encoding. The verification would report `opReturnMatch: false` but the payment would still be accepted (OP_RETURN is optional). Low direct impact but could cause confusion in audit trails.  
**Recommended Fix:** Use a proper script parser (e.g., bitcore's Script class) to extract OP_RETURN data instead of manual hex slicing.

### M-3: Invoice Replay — No Check for Already-Paid Invoices on Verification
**File:** `src/a2a/verification.ts`, lines ~68-76  
**Description:** `verifyPayment()` checks if `invoiceId` matches but doesn't check if the invoice is already in `paid` status. If an invoice was already marked paid and a second transaction sends the same amount to the same address with the same OP_RETURN, verification would return `valid: true`.  
**Exploitation:** An attacker who paid once could present the same txid again (replay), or a different txid paying the same amount. The `markInvoicePaid()` call has a status check, but the verification itself returns valid, which could confuse automated payment processing.  
**Recommended Fix:** Add `if (invoice.status !== 'pending') return { valid: false, reason: 'Invoice already settled' }` at the start of `verifyPayment()`.

### M-4: P2P Broadcast Has No Transaction Validation
**File:** `src/p2p/broadcaster.ts`  
**Description:** The P2P broadcaster sends raw transaction hex to peers without any local validation that the hex is a valid, signed transaction. A corrupted or malformed hex string would be relayed, wasting peer connections and potentially getting the node's IP banned by peers.  
**Exploitation:** If a bug in the builder/signer produces invalid hex, the P2P broadcast silently fails (peers reject it) but reports success (relay completed). The tx tracker would then wait indefinitely for confirmation.  
**Recommended Fix:** Validate the transaction hex locally before P2P relay (e.g., deserialize with bitcore to check it's well-formed).

### M-5: `sanitizeErrorMessage` Over-Aggressively Redacts Tokens
**File:** `src/security/sanitizer.ts`, line ~499  
**Description:** `message.replace(/[\w\-]{20,}/g, "[redacted]")` replaces any alphanumeric string of 20+ chars. This would redact transaction IDs (64 hex chars), addresses (34 chars), and other legitimate diagnostic information, making debugging impossible.  
**Exploitation:** Not a direct vulnerability, but hampers incident response when real errors occur with real money.  
**Recommended Fix:** Use more targeted redaction patterns (e.g., only redact strings that look like API keys/tokens, not txids/addresses).

### M-6: Onboarding Config Write Goes to Parent Directory
**File:** `src/onboarding/flow.ts`, lines ~601-603  
**Description:** `const configPath = join(this.dataDir, '..', 'config.json')` writes to a path relative to dataDir's parent. This is a path traversal pattern. If `dataDir` is misconfigured, this could overwrite arbitrary files.  
**Exploitation:** If an attacker controls the `dataDir` config value, they could write to any location. In practice, `dataDir` comes from plugin config, so this requires config manipulation.  
**Recommended Fix:** Use a well-known absolute path or validate that the resolved path is within expected boundaries.

---

## LOW

### L-1: Keystore Validation Accepts `dklen` as Low as 16
**File:** `src/keys/encryption.ts`, line ~190  
**Description:** `isKeystoreValid()` accepts `dklen >= 16` (128-bit key). While decryption validates N/r/p strictly, a malicious keystore with `dklen: 16` would derive a 128-bit key instead of 256-bit, halving the encryption strength.  
**Exploitation:** Requires replacing the keystore file on disk with a crafted version. If the attacker has disk access, they likely don't need this.  
**Recommended Fix:** Validate `dklen === 32` (or `dklen >= 32`).

### L-2: No File Integrity Check on Keystore
**File:** `src/keys/manager.ts`, `readKeystore()`  
**Description:** The keystore file has no HMAC or signature. An attacker with write access to the file could replace it with a keystore encrypted with a known passphrase containing a different private key.  
**Exploitation:** Requires disk write access. The attacker would substitute their own key, causing the wallet to sign with their key (which has no funds). More of a denial-of-service than fund theft. However, if the attacker also controls the API responses, they could trick the wallet into signing their transactions.  
**Recommended Fix:** Add an HMAC of the keystore contents using a key derived from the passphrase, stored separately.

### L-3: `wallet:unlock` Rate Limit May Be Insufficient for Brute Force Protection
**File:** `src/security/rate-limiter.ts`, line ~62  
**Description:** `wallet:unlock` allows 5 attempts per minute. The scrypt KDF is slow (~1s per attempt with N=131072), which provides good inherent protection. However, 5/minute = 300/hour = 7,200/day. For a weak passphrase, this could be brute-forced over days.  
**Exploitation:** Automated brute force against a weak passphrase over an extended period.  
**Recommended Fix:** Implement exponential backoff on consecutive failures (e.g., 1s, 2s, 4s, 8s...) rather than a flat rate limit. Or reduce to 3/minute with increasing lockout periods.

### L-4: Audit Log Has No Tamper Protection
**File:** `src/audit.ts`  
**Description:** The audit log is a JSONL file with 0600 permissions. There's no hash chain, HMAC, or other integrity mechanism. An attacker with file access could modify or delete audit entries.  
**Exploitation:** After stealing funds, an attacker could erase the evidence from the audit trail.  
**Recommended Fix:** Implement a hash chain (each entry includes hash of previous entry) to detect tampering.

### L-5: SSRF Protection Doesn't Cover DNS Rebinding
**File:** `src/a2a/callback.ts`, `isValidCallbackUrl()`  
**Description:** SSRF checks validate the hostname at URL parse time, but DNS rebinding attacks could resolve a public hostname to a private IP after validation passes.  
**Exploitation:** A callback URL like `https://evil.example.com/` could first resolve to a public IP (passing validation), then resolve to `127.0.0.1` when the actual HTTP request is made.  
**Recommended Fix:** Resolve DNS before making the request and validate the resolved IP, or use a DNS-pinning HTTP client.

### L-6: SoChain Balance Conversion May Lose Precision
**File:** `src/api/sochain.ts`, lines ~102-103  
**Description:** `Math.round(parseFloat(value) * 1e8)` converts DOGE strings to koinu. Floating-point multiplication can produce values like `99999999.99999999` instead of `100000000`. While `Math.round` handles most cases, edge cases exist.  
**Exploitation:** Off-by-one koinu errors in balance display or UTXO amounts. Unlikely to cause fund loss but could cause failed transactions if the balance is exactly at the threshold.  
**Recommended Fix:** Use integer arithmetic: parse the string, split on `.`, and compute `integer_part * 1e8 + decimal_part_padded`.

### L-7: `derivePublicFromPrivate` Uses `require()` (CJS in ESM Module)
**File:** `src/keys/manager.ts`, line ~306  
**Description:** Uses `require("secp256k1")` inside an ESM module. While this works in Node.js, it's fragile and could break with stricter ESM enforcement in future Node versions.  
**Recommended Fix:** Use dynamic `import()` or static import.

### L-8: Recovery Allows Overwriting Existing Wallet Without Confirmation
**File:** `src/keys/manager.ts`, lines ~145-147  
**Description:** Comment says "Allow recovery to overwrite existing wallet (user explicitly chose this)" but there's no programmatic guard. If `recover()` is called when a wallet already exists, the old keystore is silently replaced.  
**Exploitation:** A prompt injection attack could trick the agent into calling `recover()` with an attacker's mnemonic, replacing the user's wallet.  
**Recommended Fix:** Require explicit confirmation (e.g., a `force: true` parameter) when overwriting an existing wallet.

---

## INFO

### I-1: Good — Private Keys Never Logged
All logging throughout the codebase carefully avoids exposing private keys, mnemonics, or passphrases. Error messages are sanitized.

### I-2: Good — Atomic File Writes
Keystore and state files use write-to-temp + rename pattern, preventing corruption from crashes mid-write.

### I-3: Good — Scrypt Parameters Are Conservative
N=131072, r=8, p=1 provides ~1 second derivation time, making brute force expensive. The decryption path also validates KDF parameters to prevent downgrade attacks.

### I-4: Good — SSRF Protection on Callbacks
The callback system blocks localhost, private IPs, link-local addresses, and requires HTTPS. Auth tokens are redacted in error messages.

### I-5: Note — Dependencies
The wallet depends on `bip39`, `hdkey`, `bs58check`, `secp256k1`, `bitcore-lib-doge`, and `async-mutex`. These are well-known crypto libraries but represent a supply chain risk. A compromised dependency could exfiltrate keys. Consider: (1) pinning exact versions, (2) auditing dependency updates, (3) using `npm audit` regularly.

---

## Summary Table

| Severity | Count | Key Issues |
|----------|-------|-----------|
| CRITICAL | 2 | Private key returned by reference; mnemonic as JS string |
| HIGH | 4 | Key not zeroed after signing; passphrase in memory; no auth on approvals; API token in URL |
| MEDIUM | 6 | UTXO race condition; OP_RETURN parsing; invoice replay; P2P no validation; error redaction; path traversal |
| LOW | 8 | Weak dklen validation; no keystore integrity; brute force limits; audit tampering; DNS rebinding; precision; CJS require; recovery overwrite |
| INFO | 5 | Good practices noted; dependency supply chain risk |

---

## Priority Remediation Order

1. **C-1 + H-1**: Fix private key reference/zeroing (low effort, high impact)
2. **H-3**: Add authentication to approval operations (medium effort, high impact)
3. **M-1**: Atomic select-and-lock for UTXOs (medium effort, prevents confusion)
4. **M-3**: Check invoice status in verification (trivial fix)
5. **L-8**: Guard wallet recovery overwrite (low effort, prevents prompt injection)
6. **C-2**: Document mnemonic memory limitation prominently (already partially done)
7. **H-4**: Investigate BlockCypher header-based auth (API limitation)
8. Everything else in severity order
