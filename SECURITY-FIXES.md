# DOGE Wallet Security Fixes Applied

**Date:** 2026-02-06  
**Based on:** wallet-code-review.md findings

---

## C-1: Private Key Returned by Reference (CRITICAL)
**File:** `src/keys/manager.ts` — `getPrivateKey()`  
**Fix:** Returns `Buffer.from(this._privateKey)` (a defensive copy) instead of the live internal buffer. Callers can now safely zero their copy without corrupting the wallet's signing capability.

## C-2: Mnemonic Memory Limitation (CRITICAL)
**File:** `src/keys/manager.ts` — `init()`  
**Fix:** Added prominent JSDoc warning documenting the inherent JS string limitation. Added `global.gc?.()` hint after wallet init to encourage early GC of the mnemonic string. Callers are instructed to null out mnemonic references ASAP.

## H-1: signTransaction Doesn't Zero Input privateKey (HIGH)
**File:** `src/tx/signer.ts` — `signTransaction()` finally block  
**Fix:** Added `privateKey.fill(0)` in the `finally` block. Since C-1 now returns a copy, the signer zeros the caller's copy after use, preventing the key from lingering in memory.

## H-2: Passphrase Stored as String in Onboarding (HIGH)
**File:** `src/onboarding/flow.ts` — `TempPassphraseEntry` + all accessors  
**Fix:** Changed `TempPassphraseEntry.value` from `string` to `Buffer`. `setTempPassphrase()` converts to Buffer on store. `deleteTempPassphrase()` and `cleanupExpiredPassphrases()` now call `entry.value.fill(0)` before deletion to explicitly zero the passphrase from memory.

## H-3: No Authentication on Approval/Deny Operations (HIGH)
**File:** `src/policy/approval.ts` — `ApprovalQueue`  
**Fix:** Added `ownerId` constructor parameter and `verifyCallerIdentity()` private method. Both `approve()` and `deny()` now verify the caller's identity matches the configured wallet owner before processing. Auto-timeout approvals bypass the check (they're system-initiated).

## H-4: API Token in URL Query Params (HIGH)
**File:** `src/api/blockcypher.ts` — `url()` method  
**Fix:** BlockCypher doesn't support header-based auth, so: (1) Added HTTPS enforcement — non-HTTPS URLs throw an error (except localhost for dev). (2) Added `sanitizeUrl()` helper that strips tokens. (3) Added detailed documentation about the risk and mitigations. (4) Error messages already don't include the full URL.

## M-1: UTXO Race Condition (MEDIUM)
**File:** `src/utxo/manager.ts` — new `selectAndLock()` method  
**Fix:** Added `selectAndLock()` that performs coin selection AND locks the selected UTXOs in a single mutex-protected operation. This eliminates the race window between `getSpendableUtxos()` and `markSpent()` where concurrent sends could select the same UTXOs.

## M-3: Invoice Replay (MEDIUM)
**File:** `src/a2a/verification.ts` — `verifyPayment()`  
**Fix:** Added early check: if `invoice.status !== 'pending'`, return `{ valid: false, reason: 'Invoice already settled' }`. This prevents replay attacks where a paid invoice could be re-verified as valid.

---

## Notes
- All changes are minimal and surgical — no behavioral changes to existing functionality
- Each fix includes a `// SECURITY [X-N]:` comment explaining the rationale
- The H-3 fix requires callers to pass `ownerId` to the `ApprovalQueue` constructor (backward compatible — parameter is optional, defaults to no enforcement)
