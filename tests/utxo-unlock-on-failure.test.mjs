/**
 * Test: UTXOs are unlocked when a tracked transaction fails.
 * Verifies fix for https://github.com/Quackstro/openclaw-doge-wallet/issues/1
 *
 * Tests:
 * 1. UtxoManager correctly locks and unlocks UTXOs
 * 2. Finding locked UTXOs by lockedFor txid works
 * 3. Balance recalculates correctly after unlock
 */

import { UtxoManager } from "../dist/src/utxo/manager.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KOINU_PER_DOGE = 100_000_000;

// Mock provider — not needed for lock/unlock tests
const mockProvider = {
  getUtxos: async () => [],
  getTransaction: async () => ({ confirmations: 0 }),
  broadcastTransaction: async () => ({ txid: "mock" }),
};

const logs = [];
const log = (level, msg) => logs.push(`[${level}] ${msg}`);

let tmpDir;
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.error(`  ❌ ${label}`);
  }
}

async function setup() {
  tmpDir = await mkdtemp(join(tmpdir(), "doge-wallet-test-"));
  const mgr = new UtxoManager(tmpDir, mockProvider, log);

  // Manually inject test UTXOs (simulating a loaded cache)
  mgr["utxos"] = [
    {
      txid: "aaa111",
      vout: 0,
      address: "DTestAddr",
      amount: 1 * KOINU_PER_DOGE,
      scriptPubKey: "76a914...88ac",
      confirmations: 10,
      locked: false,
    },
    {
      txid: "aaa111",
      vout: 1,
      address: "DTestAddr",
      amount: 8 * KOINU_PER_DOGE,
      scriptPubKey: "76a914...88ac",
      confirmations: 10,
      locked: true,
      lockedAt: new Date().toISOString(),
      lockedFor: "failed-tx-123",
    },
    {
      txid: "bbb222",
      vout: 0,
      address: "DTestAddr",
      amount: 5 * KOINU_PER_DOGE,
      scriptPubKey: "76a914...88ac",
      confirmations: 10,
      locked: true,
      lockedAt: new Date().toISOString(),
      lockedFor: "other-tx-456",
    },
  ];
  mgr["loaded"] = true;
  mgr["address"] = "DTestAddr";

  return mgr;
}

async function testBalanceExcludesLockedUtxos() {
  console.log("\nTest 1: Balance excludes locked UTXOs");
  const mgr = await setup();

  const balance = mgr.getBalance();
  assert(balance.confirmed === 1 * KOINU_PER_DOGE, `Confirmed balance is 1 DOGE (got ${balance.confirmed / KOINU_PER_DOGE})`);
  assert(balance.total === 1 * KOINU_PER_DOGE, `Total balance is 1 DOGE (got ${balance.total / KOINU_PER_DOGE})`);
}

async function testUnlockUtxo() {
  console.log("\nTest 2: unlockUtxo releases a specific UTXO");
  const mgr = await setup();

  const ok = await mgr.unlockUtxo("aaa111", 1);
  assert(ok === true, "unlockUtxo returns true");

  const utxo = mgr.getUtxos().find((u) => u.txid === "aaa111" && u.vout === 1);
  assert(utxo.locked === false, "UTXO is now unlocked");
  assert(utxo.lockedAt === undefined, "lockedAt is cleared");
  assert(utxo.lockedFor === undefined, "lockedFor is cleared");
}

async function testBalanceAfterUnlock() {
  console.log("\nTest 3: Balance recalculates after unlocking failed tx UTXOs");
  const mgr = await setup();

  // Before unlock
  assert(mgr.getBalance().confirmed === 1 * KOINU_PER_DOGE, "Before: 1 DOGE confirmed");

  // Simulate the unlockUtxosForTx logic from the fix
  const failedTxid = "failed-tx-123";
  const utxos = mgr.getUtxos();
  for (const utxo of utxos) {
    if (utxo.locked && utxo.lockedFor === failedTxid) {
      await mgr.unlockUtxo(utxo.txid, utxo.vout);
    }
  }

  // After unlock — should recover the 8 DOGE
  const after = mgr.getBalance();
  assert(after.confirmed === 9 * KOINU_PER_DOGE, `After: 9 DOGE confirmed (got ${after.confirmed / KOINU_PER_DOGE})`);
}

async function testOnlyUnlocksMatchingTxid() {
  console.log("\nTest 4: Only unlocks UTXOs matching the failed txid");
  const mgr = await setup();

  const failedTxid = "failed-tx-123";
  const utxos = mgr.getUtxos();
  for (const utxo of utxos) {
    if (utxo.locked && utxo.lockedFor === failedTxid) {
      await mgr.unlockUtxo(utxo.txid, utxo.vout);
    }
  }

  // The other locked UTXO (for other-tx-456) should still be locked
  const otherUtxo = mgr.getUtxos().find((u) => u.txid === "bbb222" && u.vout === 0);
  assert(otherUtxo.locked === true, "Other UTXO still locked");
  assert(otherUtxo.lockedFor === "other-tx-456", "Other UTXO lockedFor unchanged");

  // Balance should be 1 + 8 = 9 (not 14 — the 5 DOGE is still locked)
  assert(mgr.getBalance().confirmed === 9 * KOINU_PER_DOGE, `Balance is 9 DOGE (not 14)`);
}

async function testSpendableUtxos() {
  console.log("\nTest 5: getSpendableUtxos reflects unlock");
  const mgr = await setup();

  const before = await mgr.getSpendableUtxos(1);
  assert(before.length === 1, `Before: 1 spendable UTXO (got ${before.length})`);

  await mgr.unlockUtxo("aaa111", 1);

  const after = await mgr.getSpendableUtxos(1);
  assert(after.length === 2, `After: 2 spendable UTXOs (got ${after.length})`);
}

// Run all tests
console.log("🐕 UTXO Unlock on TX Failure — Test Suite");
console.log("==========================================");

await testBalanceExcludesLockedUtxos();
await testUnlockUtxo();
await testBalanceAfterUnlock();
await testOnlyUnlocksMatchingTxid();
await testSpendableUtxos();

console.log(`\n${"=".repeat(42)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

// Cleanup
if (tmpDir) await rm(tmpDir, { recursive: true, force: true });

process.exit(failed > 0 ? 1 : 0);
