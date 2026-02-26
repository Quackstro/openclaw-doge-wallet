/**
 * Config parsing tests — 7 cases covering defaults, merging, and validation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseDogeConfig } from "../dist/src/config.js";

describe("parseDogeConfig", () => {
  it("returns defaults for empty object", () => {
    const cfg = parseDogeConfig({});
    assert.equal(cfg.network, "mainnet");
    assert.equal(cfg.api.primary, "blockcypher");
    assert.equal(cfg.fees.strategy, "medium");
    assert.equal(cfg.policy.enabled, true);
  });

  it("deep merges user config over defaults", () => {
    const cfg = parseDogeConfig({
      network: "testnet",
      fees: { strategy: "low" },
    });
    assert.equal(cfg.network, "testnet");
    assert.equal(cfg.fees.strategy, "low");
    // Non-overridden defaults preserved
    assert.equal(cfg.fees.maxFeePerKb, 200000000);
    assert.equal(cfg.api.primary, "blockcypher");
  });

  it("security field is not present (removed)", () => {
    const cfg = parseDogeConfig({});
    assert.equal(cfg.security, undefined);
  });

  it("invalid network throws", () => {
    assert.throws(
      () => parseDogeConfig({ network: "regtest" }),
      /invalid network/,
    );
  });

  it("invalid provider throws", () => {
    assert.throws(
      () => parseDogeConfig({ api: { primary: "etherscan" } }),
      /invalid primary provider/,
    );
  });

  it("invalid fee strategy throws", () => {
    assert.throws(
      () => parseDogeConfig({ fees: { strategy: "ultra" } }),
      /invalid fee strategy/,
    );
  });

  it("UTXO refreshIntervalSeconds default is 180", () => {
    const cfg = parseDogeConfig({});
    assert.equal(cfg.utxo.refreshIntervalSeconds, 180);
  });

  it("QP defaults are applied", () => {
    const cfg = parseDogeConfig({});
    assert.ok(cfg.qp, "qp config should exist");
    assert.equal(cfg.qp.providerEnabled, false);
    assert.deepEqual(cfg.qp.skills, []);
    assert.equal(cfg.qp.advertiseTtlBlocks, 10_080);
    assert.equal(cfg.qp.scanIntervalMs, 60_000);
    assert.equal(cfg.qp.autoRate, true);
    assert.equal(cfg.qp.defaultRating, 5);
  });

  it("invalid qp.defaultRating throws", () => {
    assert.throws(
      () => parseDogeConfig({ qp: { defaultRating: 0 } }),
      /qp.defaultRating must be 1-5/,
    );
    assert.throws(
      () => parseDogeConfig({ qp: { defaultRating: 6 } }),
      /qp.defaultRating must be 1-5/,
    );
  });
});
