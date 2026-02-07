/**
 * Tests for AuditLog.logReceive() — receive deduplication by txid.
 *
 * Run: npx tsx --test tests/audit-dedup.test.ts
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditLog } from "../src/audit.js";

describe("AuditLog — logReceive deduplication", () => {
  let dataDir: string;
  let audit: AuditLog;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "doge-audit-test-"));
    // AuditLog writes to <dataDir>/audit/audit.jsonl — ensure dir exists
    await mkdir(join(dataDir, "audit"), { recursive: true });
    audit = new AuditLog(dataDir);
  });

  it("first logReceive creates an entry", async () => {
    const entry = await audit.logReceive("tx_abc", "DFrom1", 50_000_000, 3);
    assert.equal(entry.action, "receive");
    assert.equal(entry.txid, "tx_abc");
    assert.equal(entry.amount, 50_000_000);
    assert.ok(entry.id);
    assert.ok(entry.timestamp);
  });

  it("second logReceive for same txid is skipped (no duplicate)", async () => {
    await audit.logReceive("tx_dup", "DFrom1", 100_000_000, 1);
    await audit.logReceive("tx_dup", "DFrom1", 100_000_000, 5);

    const receives = await audit.getByAction("receive", 100);
    const matching = receives.filter((e) => e.txid === "tx_dup");
    assert.equal(matching.length, 1);
  });

  it("returned entry for duplicate matches the original", async () => {
    const first = await audit.logReceive("tx_same", "DFrom2", 75_000_000, 1);
    const second = await audit.logReceive("tx_same", "DFrom2", 75_000_000, 6);

    assert.equal(second.id, first.id);
    assert.equal(second.timestamp, first.timestamp);
    assert.equal(second.txid, first.txid);
  });

  it("different txids are logged independently", async () => {
    await audit.logReceive("tx_a", "DFrom1", 10_000_000, 1);
    await audit.logReceive("tx_b", "DFrom2", 20_000_000, 2);
    await audit.logReceive("tx_c", "DFrom3", 30_000_000, 3);

    const all = await audit.getByAction("receive", 100);
    assert.equal(all.length, 3);

    const txids = new Set(all.map((e) => e.txid));
    assert.ok(txids.has("tx_a"));
    assert.ok(txids.has("tx_b"));
    assert.ok(txids.has("tx_c"));
  });
});
