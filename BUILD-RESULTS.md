# DOGE Wallet Plugin — Build & Test Results

**Date:** 2026-02-06 15:57 UTC  
**Plugin:** @quackstro/doge-wallet v0.1.0  
**Location:** /home/clawdbot/.openclaw/extensions/doge-wallet/

## Build

- **Command:** `npm run build` (→ `tsc`)
- **Result:** ✅ Success — no errors, no warnings
- **Output directory:** `dist/` containing `index.js`, `index.d.ts`, `src/` subdirectory

## Tests

- **Command:** `node --test tests/utxo-unlock-on-failure.test.mjs`
- **Result:** ✅ All 13 assertions passed, 0 failed
- **Duration:** 65ms
- **Test file:** `utxo-unlock-on-failure.test.mjs`

### Test Coverage
1. Balance excludes locked UTXOs ✅
2. unlockUtxo releases a specific UTXO ✅
3. Balance recalculates after unlocking failed tx UTXOs ✅
4. Only unlocks UTXOs matching the failed txid ✅
5. getSpendableUtxos reflects unlock ✅

## Summary

Build and tests clean. No issues found.
