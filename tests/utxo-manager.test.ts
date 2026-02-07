/**
 * Tests for UtxoManager.addUtxo() — optimistic change UTXO tracking.
 *
 * Run: npx tsx --test tests/utxo-manager.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { UtxoManager } from "../src/utxo/manager.js";
import type { UTXO, DogeApiProvider } from "../src/types.js";

function makeUtxo(partial: Partial<UTXO> = {}): UTXO {
  return {
    txid: partial.txid ?? "aaaa",
    vout: partial.vout ?? 0,
    address: partial.address ?? "D1234",
    amount: partial.amount ?? 500_000_000,
    scriptPubKey: partial.scriptPubKey ?? "76a914abc88ac",
    confirmations: partial.confirmations ?? 6,
    locked: partial.locked ?? false,
    ...partial,
  };
}

const stubProvider: DogeApiProvider = {
  getUtxos: async () => [],
  getBalance: async () => ({ confirmed: 0, unconfirmed: 0 }),
  broadcastTx: async () => "mocktxid",
  getTransaction: async () => ({} as any),
  getBlockHeight: async () => 1,
  getName: () => "stub",
  isHealthy: async () => true,
} as any;

describe("UtxoManager — addUtxo (optimistic change)", () => {
  let dataDir: string;
  let mgr: UtxoManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "doge-utxo-test-"));
    mgr = new UtxoManager(dataDir, stubProvider);
  });

  it("adds a change UTXO that appears in getUtxos()", async () => {
    const u = makeUtxo({ txid: "tx1", vout: 1, amount: 100_000_000 });
    await mgr.addUtxo(u);
    const utxos = mgr.getUtxos();
    assert.equal(utxos.length, 1);
    assert.equal(utxos[0].txid, "tx1");
    assert.equal(utxos[0].vout, 1);
  });

  it("balance immediately reflects the added change UTXO", async () => {
    assert.equal(mgr.getBalance().total, 0);
    await mgr.addUtxo(makeUtxo({ amount: 200_000_000, confirmations: 0 }));
    assert.equal(mgr.getBalance().unconfirmed, 200_000_000);
    assert.equal(mgr.getBalance().total, 200_000_000);
  });

  it("deduplicates by txid:vout", async () => {
    const u = makeUtxo({ txid: "dup", vout: 0, amount: 100_000_000 });
    await mgr.addUtxo(u);
    await mgr.addUtxo(u);
    await mgr.addUtxo({ ...u, amount: 999 }); // same txid:vout, different amount
    assert.equal(mgr.getUtxos().length, 1);
  });

  it("spent input UTXOs are locked after selectAndLock", async () => {
    // Pre-populate with a spendable UTXO
    await mgr.addUtxo(makeUtxo({ txid: "inp1", vout: 0, amount: 500_000_000, confirmations: 6 }));

    const selector = (utxos: UTXO[], target: number) => ({
      selected: utxos.slice(0, 1),
      total: utxos[0].amount,
      fee: 1_000_000,
      change: utxos[0].amount - target - 1_000_000,
    });

    await mgr.selectAndLock(selector, 100_000_000);

    const all = mgr.getUtxos();
    assert.equal(all.length, 1);
    assert.equal(all[0].locked, true);
    // Locked UTXOs excluded from balance
    assert.equal(mgr.getBalance().total, 0);
  });
});
