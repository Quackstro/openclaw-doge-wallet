# DOGE Wallet Plugin — Code Audit Report

**Date:** 2026-02-07
**Auditor:** Jarvis (automated)
**Scope:** Full codebase (~13,500+ lines, 50+ source files)
**Overall Health Score: 8/10**

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 0 |
| 🟠 HIGH | 1 |
| 🟡 MEDIUM | 4 |
| 🔵 LOW | 5 |
| ℹ️ INFO | 3 |

---

## Findings

### 🟠 HIGH

**H-1: Private key zeroing only in signer, not in wallet manager**
- **File:** `src/tx/signer.ts:160` — `privateKey.fill(0)` ✅
- **Issue:** Key is zeroed after signing, but `getPrivateKey()` returns the key to the caller in `index.ts`. If `executeSend()` throws between getting the key and signing, the key buffer remains in memory unzeroed.
- **Suggestion:** Wrap `executeSend()` key handling in try/finally to ensure zeroing on all paths.

---

### 🟡 MEDIUM

**M-1: 30 `any` type annotations across codebase**
- **Files:** `index.ts` (most), various handlers
- **Issue:** `ctx: any` on all command handlers reduces type safety. Could miss breaking changes in the plugin API.
- **Suggestion:** Define a `CommandContext` interface and type handlers properly.

**M-2: `parseFloat` without bounds checking on send amounts**
- **File:** `index.ts:789,793`
- **Issue:** `parseFloat("999999999999")` could exceed wallet balance but there's no explicit max-amount validation before policy check. Relies on UTXO selection to fail.
- **Suggestion:** Add explicit amount bounds check (> 0, < MAX_DOGE_SUPPLY) before policy evaluation.

**M-3: P2P protocol module largely unused**
- **File:** `src/p2p/protocol.ts`
- **Issue:** 15+ exported functions appear unused — `MAGIC_BYTES`, `buildMessage`, `parseMessageHeader`, `buildVersionPayload`, etc. Dead code increases attack surface.
- **Suggestion:** Remove unused exports or mark as `@internal` if planned for future use.

**M-4: Receive monitor has no backoff on repeated API failures**
- **File:** `src/receive-monitor.ts`
- **Issue:** If the API is rate-limited, the monitor polls every 60s regardless, wasting quota on guaranteed failures.
- **Suggestion:** Implement exponential backoff — double the interval on failure, reset on success.

---

### 🔵 LOW

**L-1: `dogeToKoinu` uses `Math.round(doge * 1e8)` — floating point risk**
- **File:** `src/types.ts:417`
- **Issue:** `0.1 + 0.2 = 0.30000000000000004` in JS. `Math.round` mitigates most cases but edge cases exist with very precise amounts.
- **Suggestion:** Consider using string-based decimal math or `BigInt` for financial calculations.

**L-2: Audit log `getAuditLog(10000)` on first receive could be slow with large files**
- **File:** `src/audit.ts` — `loadSeenReceiveTxids()`
- **Issue:** Reads and parses up to 10,000 JSONL lines on first receive. Fine for now but could lag with years of history.
- **Suggestion:** Consider a separate receive-txid index file, or cap to last N entries.

**L-3: No CSRF/auth on approval — any message sender can approve**
- **File:** `index.ts` — `handleWalletApprove()`
- **Issue:** `callerId` is passed from `ctx.chatId` but there's no allowlist check. Any Telegram user who can message the bot could approve sends.
- **Suggestion:** Validate `callerId` against an owner allowlist in the policy engine.

**L-4: Invoice expiry check only on explicit verify — no background cleanup**
- **File:** `src/a2a/invoice.ts`
- **Issue:** Expired invoices are only marked expired when `verifyPayment()` is called. Stale invoices accumulate.
- **Suggestion:** Add periodic cleanup in the invoice manager.

**L-5: `dist/` committed to repo**
- **Issue:** Build artifacts in version control. Can cause merge conflicts and bloats the repo.
- **Suggestion:** Add `dist/` to `.gitignore` and build on deploy. (May be intentional for plugin distribution.)

---

### ℹ️ INFO

**I-1: TypeScript strict mode — clean compile** ✅
- `npx tsc --noEmit` passes with zero errors.

**I-2: All 8 unit tests passing** ✅
- 4 UTXO manager tests, 4 audit dedup tests.
- **Coverage gap:** No tests for send flow, policy engine, invoice lifecycle, P2P broadcast, or onboarding flow.

**I-3: File permissions correct** ✅
- Keystore: `0600` (owner read/write only)
- Keys directory: `0700` (owner only)

---

## Security Summary

| Area | Status |
|------|--------|
| Private key zeroing | ⚠️ Zeroed in signer, not guaranteed on all error paths |
| Passphrase handling | ✅ Auto-delete messages, no disk persistence |
| Keystore encryption | ✅ AES-256-GCM + scrypt |
| File permissions | ✅ 0600/0700 enforced |
| Input validation | ⚠️ Address validated, amount not bounds-checked |
| Race conditions | ✅ Mutex on UTXO manager and invoice state |
| Message deletion | ✅ Passphrase/mnemonic messages auto-deleted |
| Approval auth | ⚠️ No owner allowlist check |

---

## Recommendations (Priority Order)

1. **H-1:** Add try/finally key zeroing in executeSend
2. **M-4:** Add exponential backoff to receive monitor
3. **L-3:** Add owner allowlist for approval commands
4. **M-1:** Type command handlers properly (remove `any`)
5. **M-2:** Add amount bounds validation
6. Expand test coverage (send flow, policy engine, invoices)
