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

  it("security.autoLockMs default is 300000", () => {
    const cfg = parseDogeConfig({});
    assert.equal(cfg.security.autoLockMs, 300_000);
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

  it("UTXO refreshIntervalSeconds default is 600", () => {
    const cfg = parseDogeConfig({});
    assert.equal(cfg.utxo.refreshIntervalSeconds, 600);
  });
});
