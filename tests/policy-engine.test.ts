/**
 * PolicyEngine + LimitTracker tests — 9 cases covering tiers, limits, and controls.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PolicyEngine } from "../dist/src/policy/engine.js";
import { LimitTracker } from "../dist/src/policy/limits.js";

const DEFAULT_POLICY = {
  enabled: true,
  tiers: {
    micro:  { maxAmount: 10,    approval: "auto" },
    small:  { maxAmount: 100,   approval: "auto-logged" },
    medium: { maxAmount: 1000,  approval: "notify-delay", delayMinutes: 5 },
    large:  { maxAmount: 10000, approval: "owner-required" },
    sweep:  { maxAmount: null,  approval: "owner-confirm-code" },
  },
  limits: {
    dailyMax: 5000,
    hourlyMax: 1000,
    txCountDailyMax: 50,
    cooldownSeconds: 10,
  },
  allowlist: [] as string[],
  denylist: [] as string[],
  freeze: false,
};

const ADDR = "D84hUKd37sKjmvfweAAs3CRWiZYuP54ygU";

let tmpDir: string;
let limits: LimitTracker;

function makeEngine(overrides: any = {}) {
  const cfg = { ...DEFAULT_POLICY, ...overrides };
  if (overrides.limits) cfg.limits = { ...DEFAULT_POLICY.limits, ...overrides.limits };
  if (overrides.tiers) cfg.tiers = { ...DEFAULT_POLICY.tiers, ...overrides.tiers };
  return new PolicyEngine(cfg, limits);
}

describe("PolicyEngine", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pe-test-"));
    limits = new LimitTracker(tmpDir, DEFAULT_POLICY.limits);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("micro tier (<=10 DOGE) auto-approved", () => {
    const engine = makeEngine();
    const result = engine.evaluate(5, ADDR, "test");
    assert.equal(result.allowed, true);
    assert.equal(result.tier, "micro");
    assert.equal(result.action, "auto");
  });

  it("small tier (<=100 DOGE) auto-logged", () => {
    const engine = makeEngine();
    const result = engine.evaluate(50, ADDR, "test");
    assert.equal(result.allowed, true);
    assert.equal(result.tier, "small");
    assert.equal(result.action, "notify");
  });

  it("medium tier (<=1000 DOGE) notify-delay", () => {
    const engine = makeEngine();
    const result = engine.evaluate(500, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.equal(result.tier, "medium");
    assert.equal(result.action, "delay");
  });

  it("large tier (<=10000 DOGE) owner-required", () => {
    const engine = makeEngine();
    const result = engine.evaluate(5000, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.equal(result.tier, "large");
    assert.equal(result.action, "approve");
  });

  it("daily limit enforcement", () => {
    const engine = makeEngine();
    // Record spending near the daily limit
    limits.recordSpend(4999 * 1e8); // 4999 DOGE in koinu
    const result = engine.evaluate(10, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Daily limit/i);
  });

  it("hourly limit enforcement", () => {
    const engine = makeEngine();
    limits.recordSpend(999 * 1e8);
    const result = engine.evaluate(10, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Hourly limit/i);
  });

  it("allowlist bypasses tier check", () => {
    const engine = makeEngine({ allowlist: [ADDR] });
    const result = engine.evaluate(5000, ADDR, "test");
    assert.equal(result.allowed, true);
    assert.equal(result.action, "auto");
    assert.match(result.reason, /allowlist/i);
  });

  it("denylist blocks send", () => {
    const engine = makeEngine({ denylist: [ADDR] });
    const result = engine.evaluate(1, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /denylist/i);
  });

  it("frozen wallet blocks all sends", () => {
    const engine = makeEngine({ freeze: true });
    const result = engine.evaluate(1, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /FROZEN/i);
  });

  it("cooldown between transactions", () => {
    const engine = makeEngine({ limits: { cooldownSeconds: 60 } });
    limits.recordSpend(1 * 1e8);
    // Immediately try another — cooldown not elapsed
    const result = engine.evaluate(1, ADDR, "test");
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Cooldown/i);
  });
});
