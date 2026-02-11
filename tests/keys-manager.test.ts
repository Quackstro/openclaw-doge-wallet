/**
 * WalletManager unit tests — 12 cases covering init, lock/unlock, auto-lock, recover.
 *
 * Uses Node.js built-in test runner. Imports compiled JS from dist/.
 * Each test gets a fresh temp directory.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Import from compiled JS
import { WalletManager } from "../dist/src/keys/manager.js";

const PASSPHRASE = "test-pass-12345";
let tmpDir: string;
let mgr: WalletManager;

describe("WalletManager", () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "wm-test-"));
    mgr = new WalletManager(tmpDir, "mainnet");
  });

  afterEach(async () => {
    mgr.lock(); // clear timers
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ---- init ----

  it("init() creates keystore file on disk", async () => {
    const result = await mgr.init(PASSPHRASE);
    assert.ok(result.mnemonic, "mnemonic returned");
    assert.ok(result.address.startsWith("D"), "mainnet address");
    const keystorePath = join(tmpDir, "keys", "wallet.json");
    assert.ok(existsSync(keystorePath), "keystore file exists");
  });

  it("init() throws if wallet already initialized", async () => {
    await mgr.init(PASSPHRASE);
    await assert.rejects(() => mgr.init(PASSPHRASE), (err: any) => {
      assert.equal(err.code, "WALLET_ALREADY_INITIALIZED");
      return true;
    });
  });

  // ---- unlock ----

  it("unlock() decrypts and holds key in memory", async () => {
    await mgr.init(PASSPHRASE);
    mgr.lock();
    assert.equal(mgr.isUnlocked(), false);
    await mgr.unlock(PASSPHRASE);
    assert.equal(mgr.isUnlocked(), true);
  });

  it("unlock() throws with wrong passphrase", async () => {
    await mgr.init(PASSPHRASE);
    mgr.lock();
    // Clear cached keystore so it re-reads from disk
    (mgr as any)._cachedKeystore = null;
    await assert.rejects(() => mgr.unlock("wrong-pass"), (err: any) => {
      assert.equal(err.code, "INVALID_PASSPHRASE");
      return true;
    });
  });

  // ---- lock ----

  it("lock() clears private key from memory", async () => {
    await mgr.init(PASSPHRASE);
    assert.equal(mgr.isUnlocked(), true);
    mgr.lock();
    assert.equal(mgr.isUnlocked(), false);
  });

  // ---- getPrivateKey ----

  it("getPrivateKey() throws WalletLockedError when locked", async () => {
    assert.throws(() => mgr.getPrivateKey(), (err: any) => {
      assert.equal(err.code, "WALLET_LOCKED");
      return true;
    });
  });

  it("getPrivateKey() returns Buffer when unlocked", async () => {
    await mgr.init(PASSPHRASE);
    const pk = mgr.getPrivateKey();
    assert.ok(Buffer.isBuffer(pk));
    assert.equal(pk.length, 32);
  });

  // ---- auto-lock ----

  it("setAutoLockMs() + auto-lock timer fires after timeout", async () => {
    await mgr.init(PASSPHRASE);
    mgr.setAutoLockMs(100);
    mgr.bumpAutoLock(); // start timer
    assert.equal(mgr.isUnlocked(), true);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(mgr.isUnlocked(), false);
  });

  it("auto-lock timer resets on getPrivateKey() call", async () => {
    await mgr.init(PASSPHRASE);
    mgr.setAutoLockMs(150);
    mgr.bumpAutoLock();
    // At 80ms, call getPrivateKey to reset timer
    await new Promise((r) => setTimeout(r, 80));
    mgr.getPrivateKey(); // resets timer
    // At 160ms from start (80ms after reset), should still be unlocked
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(mgr.isUnlocked(), true, "still unlocked after reset");
    // Wait for the full 150ms after reset
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(mgr.isUnlocked(), false, "locked after full timeout");
  });

  it("auto-lock with 0 disables timer", async () => {
    await mgr.init(PASSPHRASE);
    mgr.setAutoLockMs(50);
    mgr.bumpAutoLock();
    mgr.setAutoLockMs(0);
    mgr.bumpAutoLock(); // should clear timer
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(mgr.isUnlocked(), true, "should remain unlocked");
  });

  // ---- recover ----

  it("recover() with valid mnemonic restores wallet", async () => {
    const { mnemonic, address } = await mgr.init(PASSPHRASE);
    mgr.lock();
    // Create fresh manager to simulate recovery
    const mgr2 = new WalletManager(tmpDir, "mainnet");
    // recover overwrites existing keystore
    const result = await mgr2.recover(mnemonic, PASSPHRASE);
    assert.equal(result.address, address, "same address restored");
    assert.equal(mgr2.isUnlocked(), true);
    mgr2.lock();
  });

  it("recover() with invalid mnemonic throws", async () => {
    await assert.rejects(() => mgr.recover("invalid words here", PASSPHRASE), (err: any) => {
      assert.equal(err.code, "INVALID_MNEMONIC");
      return true;
    });
  });
});
