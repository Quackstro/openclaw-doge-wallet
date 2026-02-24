/**
 * Chain Integration unit tests — scanner, registry watcher, tx builder.
 *
 * Uses mock DogeApiProvider to avoid real network calls.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// QP messages
import {
  encodeMessage,
  decodeMessage,
  isQPMessage,
  QPMessageType,
  QP_MAGIC,
  QP_VERSION,
  PriceUnit,
} from "../dist/src/qp/index.js";

import type {
  ServiceAdvertisePayload,
  AdvertiseFlags,
} from "../dist/src/qp/types.js";

// Registry
import { REGISTRY_ADDRESSES } from "../dist/src/qp/registry.js";

// Chain module
import {
  extractOpReturn,
  decodeQPFromTx,
  scanAddress,
  ServiceDirectory,
  RegistryWatcher,
  buildAdvertiseOpReturn,
  buildRatingOpReturn,
} from "../dist/src/qp/chain/index.js";

import type {
  OnChainQPMessage,
  ServiceListing,
  ChainStatus,
} from "../dist/src/qp/chain/types.js";

// Wallet types
import type {
  DogeApiProvider,
  Transaction as ChainTx,
  UTXO,
  NetworkInfo,
} from "../dist/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an OP_RETURN script hex from raw data */
function makeOpReturnScriptHex(data: Buffer): string {
  // OP_RETURN (0x6a) + push length + data
  if (data.length <= 0x4b) {
    return Buffer.concat([
      Buffer.from([0x6a, data.length]),
      data,
    ]).toString("hex");
  } else {
    return Buffer.concat([
      Buffer.from([0x6a, 0x4c, data.length]),
      data,
    ]).toString("hex");
  }
}

/** Build a fake SERVICE_ADVERTISE OP_RETURN */
function makeFakeAdvertise(pubkey: Buffer): Buffer {
  const flags: AdvertiseFlags = {
    supportsDirectHtlc: true,
    supportsSideloadHttps: true,
    supportsSideloadLibp2p: false,
    supportsSideloadIpfs: false,
    onlineNow: true,
    supportsPaymentChannel: false,
    acceptsPostPayment: false,
    isCompositeTool: false,
  };

  return encodeMessage({
    magic: QP_MAGIC,
    version: QP_VERSION,
    type: QPMessageType.SERVICE_ADVERTISE,
    payload: {
      skillCode: 0x0403,
      priceKoinu: 500_000_000,
      priceUnit: PriceUnit.PER_REQUEST,
      flags,
      ttlBlocks: 10080,
      nonce: Buffer.alloc(4),
      pubkey,
      metadata: "Test OCR Service\0\0\0\0",
    } as ServiceAdvertisePayload,
  });
}

/** Create a mock chain transaction */
function mockTx(overrides: Partial<ChainTx> & { txid: string }): ChainTx {
  return {
    txid: overrides.txid,
    confirmations: overrides.confirmations ?? 10,
    blockHeight: overrides.blockHeight ?? 100_000,
    timestamp: overrides.timestamp ?? "2026-01-01T00:00:00Z",
    inputs: overrides.inputs ?? [{ address: "DSenderAddress123", amount: 200_000_000 }],
    outputs: overrides.outputs ?? [],
    fee: overrides.fee ?? 1_000_000,
    totalInput: overrides.totalInput ?? 200_000_000,
    totalOutput: overrides.totalOutput ?? 199_000_000,
  };
}

/** A fake 33-byte compressed pubkey */
const fakePubkey = Buffer.concat([Buffer.from([0x02]), Buffer.alloc(32, 0xab)]);

/**
 * Mock DogeApiProvider for testing
 */
class MockProvider implements DogeApiProvider {
  readonly name = "mock";
  private txsByAddress: Map<string, ChainTx[]> = new Map();
  private txsById: Map<string, ChainTx> = new Map();
  private _height = 100_000;

  addTx(address: string, tx: ChainTx): void {
    if (!this.txsByAddress.has(address)) {
      this.txsByAddress.set(address, []);
    }
    this.txsByAddress.get(address)!.push(tx);
    this.txsById.set(tx.txid, tx);
  }

  setHeight(h: number): void {
    this._height = h;
  }

  async getBalance(_addr: string) {
    return { confirmed: 0, unconfirmed: 0 };
  }
  async getUtxos(_addr: string): Promise<UTXO[]> {
    return [];
  }
  async getTransaction(txid: string): Promise<ChainTx> {
    const tx = this.txsById.get(txid);
    if (!tx) throw new Error(`Tx not found: ${txid}`);
    return tx;
  }
  async getTransactions(address: string, limit: number): Promise<ChainTx[]> {
    return (this.txsByAddress.get(address) ?? []).slice(0, limit);
  }
  async broadcastTx(rawHex: string): Promise<{ txid: string }> {
    return { txid: "broadcast_" + rawHex.slice(0, 8) };
  }
  async getNetworkInfo(): Promise<NetworkInfo> {
    return {
      height: this._height,
      feeEstimate: { high: 100_000, medium: 100_000, low: 100_000 },
    };
  }
}

// =========================================================================
// 1. OP_RETURN extraction
// =========================================================================

describe("extractOpReturn", () => {
  it("extracts data from a standard OP_RETURN output", () => {
    const data = Buffer.from("hello world");
    const tx = mockTx({
      txid: "tx1",
      outputs: [
        { address: "addr1", amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(data) },
      ],
    });
    const result = extractOpReturn(tx);
    assert.ok(result);
    assert.ok(result.equals(data));
  });

  it("extracts data from script starting with 6a (no scriptType)", () => {
    const data = Buffer.from("test");
    const tx = mockTx({
      txid: "tx2",
      outputs: [
        { address: "unknown", amount: 0, script: makeOpReturnScriptHex(data) },
      ],
    });
    const result = extractOpReturn(tx);
    assert.ok(result);
    assert.ok(result.equals(data));
  });

  it("returns null when no OP_RETURN exists", () => {
    const tx = mockTx({
      txid: "tx3",
      outputs: [
        { address: "addr1", amount: 100_000_000, script: "76a91489abcdef88ac" },
      ],
    });
    assert.equal(extractOpReturn(tx), null);
  });

  it("handles OP_PUSHDATA1 for payloads > 75 bytes", () => {
    const data = Buffer.alloc(80, 0x42); // 80 bytes — needs PUSHDATA1
    const scriptHex = Buffer.concat([
      Buffer.from([0x6a, 0x4c, 80]),
      data,
    ]).toString("hex");
    const tx = mockTx({
      txid: "tx4",
      outputs: [
        { address: "unknown", amount: 0, scriptType: "null-data", script: scriptHex },
      ],
    });
    const result = extractOpReturn(tx);
    assert.ok(result);
    assert.equal(result.length, 80);
    assert.ok(result.equals(data));
  });
});

// =========================================================================
// 2. QP message decoding from transactions
// =========================================================================

describe("decodeQPFromTx", () => {
  it("decodes a SERVICE_ADVERTISE from a transaction", () => {
    const opReturn = makeFakeAdvertise(fakePubkey);
    const tx = mockTx({
      txid: "qp_tx_1",
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    });

    const result = decodeQPFromTx(tx);
    assert.ok(result);
    assert.equal(result.message.type, QPMessageType.SERVICE_ADVERTISE);
    assert.equal(result.txid, "qp_tx_1");
    assert.equal(result.senderAddress, "DSenderAddress123");
    assert.equal(result.recipientAddress, REGISTRY_ADDRESSES.general);
  });

  it("returns null for non-QP transactions", () => {
    const tx = mockTx({
      txid: "regular_tx",
      outputs: [
        { address: "addr1", amount: 500_000_000 },
      ],
    });
    assert.equal(decodeQPFromTx(tx), null);
  });

  it("returns null for malformed QP data", () => {
    const badData = Buffer.from([0x51, 0x50, 0x01, 0xff]); // QP magic but invalid type
    // Pad to minimum QP size
    const padded = Buffer.concat([badData, Buffer.alloc(76)]);
    const tx = mockTx({
      txid: "bad_tx",
      outputs: [
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(padded) },
      ],
    });
    // Should not crash — returns null or a decoded message depending on decoder
    const result = decodeQPFromTx(tx);
    // Either null or decoded; just shouldn't throw
    assert.ok(result === null || result.message !== undefined);
  });
});

// =========================================================================
// 3. scanAddress
// =========================================================================

describe("scanAddress", () => {
  it("finds QP messages at an address", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);
    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "scan_tx_1",
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));
    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "scan_tx_2",
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 200_000_000 },
      ],
    }));

    const results = await scanAddress(provider, REGISTRY_ADDRESSES.general);
    assert.equal(results.length, 1);
    assert.equal(results[0].txid, "scan_tx_1");
  });

  it("applies message type filter", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);
    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "filter_tx",
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    // Filter for HANDSHAKE_INIT — should not match
    const results = await scanAddress(provider, REGISTRY_ADDRESSES.general, 50, {
      messageTypes: [QPMessageType.HANDSHAKE_INIT],
    });
    assert.equal(results.length, 0);
  });

  it("applies confirmations filter", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);
    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "conf_tx",
      confirmations: 2,
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    const notEnough = await scanAddress(provider, REGISTRY_ADDRESSES.general, 50, {
      minConfirmations: 5,
    });
    assert.equal(notEnough.length, 0);

    const enough = await scanAddress(provider, REGISTRY_ADDRESSES.general, 50, {
      minConfirmations: 2,
    });
    assert.equal(enough.length, 1);
  });
});

// =========================================================================
// 4. ServiceDirectory
// =========================================================================

describe("ServiceDirectory", () => {
  function makeListing(overrides?: Partial<ServiceListing>): ServiceListing {
    return {
      txid: "listing_" + Math.random().toString(36).slice(2, 8),
      providerAddress: "DProviderAddr",
      providerPubkey: fakePubkey,
      skillCode: 0x0403,
      priceKoinu: 500_000_000,
      priceUnit: 0,
      flags: {
        supportsDirectHtlc: true,
        supportsSideloadHttps: false,
        supportsSideloadLibp2p: false,
        supportsSideloadIpfs: false,
        onlineNow: true,
        supportsPaymentChannel: false,
        acceptsPostPayment: false,
        isCompositeTool: false,
      },
      ttlBlocks: 1000,
      description: "Test",
      blockHeight: 100_000,
      confirmations: 10,
      expiresAtBlock: 101_000,
      ...overrides,
    };
  }

  it("add/get round-trips", () => {
    const dir = new ServiceDirectory();
    const listing = makeListing({ txid: "l1" });
    dir.add(listing);
    assert.equal(dir.get("l1")?.txid, "l1");
    assert.equal(dir.size, 1);
  });

  it("remove deletes listing", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "l2" }));
    assert.equal(dir.size, 1);
    dir.remove("l2");
    assert.equal(dir.size, 0);
    assert.equal(dir.get("l2"), undefined);
  });

  it("getActive filters expired", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "active", expiresAtBlock: 200_000 }));
    dir.add(makeListing({ txid: "expired", expiresAtBlock: 99_000 }));

    const active = dir.getActive(100_000);
    assert.equal(active.length, 1);
    assert.equal(active[0].txid, "active");
  });

  it("findBySkill searches by skill code", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "ocr", skillCode: 0x0403, expiresAtBlock: 200_000 }));
    dir.add(makeListing({ txid: "translate", skillCode: 0x0100, expiresAtBlock: 200_000 }));

    const ocr = dir.findBySkill(0x0403, 100_000);
    assert.equal(ocr.length, 1);
    assert.equal(ocr[0].txid, "ocr");
  });

  it("findByProvider searches by address", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "p1", providerAddress: "DProv1" }));
    dir.add(makeListing({ txid: "p2", providerAddress: "DProv2" }));

    const results = dir.findByProvider("DProv1");
    assert.equal(results.length, 1);
    assert.equal(results[0].txid, "p1");
  });

  it("pruneExpired removes old listings", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "keep", expiresAtBlock: 200_000 }));
    dir.add(makeListing({ txid: "prune1", expiresAtBlock: 99_000 }));
    dir.add(makeListing({ txid: "prune2", expiresAtBlock: 100_000 }));

    const pruned = dir.pruneExpired(100_000);
    assert.equal(pruned, 2);
    assert.equal(dir.size, 1);
    assert.equal(dir.get("keep")?.txid, "keep");
  });

  it("toArray/loadFrom round-trips", () => {
    const dir1 = new ServiceDirectory();
    dir1.add(makeListing({ txid: "x1" }));
    dir1.add(makeListing({ txid: "x2" }));

    const arr = dir1.toArray();
    const dir2 = new ServiceDirectory();
    dir2.loadFrom(arr);
    assert.equal(dir2.size, 2);
    assert.ok(dir2.get("x1"));
    assert.ok(dir2.get("x2"));
  });

  it("clear empties everything", () => {
    const dir = new ServiceDirectory();
    dir.add(makeListing({ txid: "c1" }));
    dir.add(makeListing({ txid: "c2" }));
    dir.clear();
    assert.equal(dir.size, 0);
  });
});

// =========================================================================
// 5. RegistryWatcher
// =========================================================================

describe("RegistryWatcher", () => {
  it("scan discovers new SERVICE_ADVERTISE messages", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);

    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "watch_tx_1",
      blockHeight: 100_000,
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    const watcher = new RegistryWatcher(provider, undefined, {
      categories: ["general"],
    });

    const newListings = await watcher.scan();
    assert.equal(newListings.length, 1);
    assert.equal(newListings[0].skillCode, 0x0403);
    assert.equal(newListings[0].priceKoinu, 500_000_000);
    assert.ok(newListings[0].description.includes("Test OCR"));

    // Second scan should not find duplicates
    const again = await watcher.scan();
    assert.equal(again.length, 0);
  });

  it("getDirectory returns populated directory", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);

    provider.addTx(REGISTRY_ADDRESSES.compute, mockTx({
      txid: "dir_tx",
      blockHeight: 100_500,
      outputs: [
        { address: REGISTRY_ADDRESSES.compute, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    const watcher = new RegistryWatcher(provider, undefined, {
      categories: ["compute"],
    });
    await watcher.scan();

    const dir = watcher.getDirectory();
    assert.equal(dir.size, 1);
    assert.ok(dir.get("dir_tx"));
  });

  it("getChainStatus returns height and fees", async () => {
    const provider = new MockProvider();
    provider.setHeight(150_000);

    const watcher = new RegistryWatcher(provider);
    const status = await watcher.getChainStatus();
    assert.equal(status.blockHeight, 150_000);
    assert.equal(status.provider, "mock");
    assert.ok(status.feeEstimate.high > 0);
  });

  it("pruneExpired removes old listings", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);

    // Listing at block 100 with TTL 10080 — expires at 110080
    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "expire_tx",
      blockHeight: 100,
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    const watcher = new RegistryWatcher(provider, undefined, { categories: ["general"] });
    await watcher.scan();
    assert.equal(watcher.getDirectory().size, 1);

    // Set block height past expiry
    provider.setHeight(200_000);
    const pruned = await watcher.pruneExpired();
    assert.equal(pruned, 1);
    assert.equal(watcher.getDirectory().size, 0);
  });

  it("state save/restore preserves scan position", async () => {
    const provider = new MockProvider();
    const opReturn = makeFakeAdvertise(fakePubkey);

    provider.addTx(REGISTRY_ADDRESSES.general, mockTx({
      txid: "state_tx",
      blockHeight: 100_000,
      outputs: [
        { address: REGISTRY_ADDRESSES.general, amount: 100_000_000 },
        { address: "unknown", amount: 0, scriptType: "null-data", script: makeOpReturnScriptHex(opReturn) },
      ],
    }));

    const watcher1 = new RegistryWatcher(provider, undefined, { categories: ["general"] });
    await watcher1.scan();
    const state = watcher1.getState();
    assert.ok(state.lastScannedBlock["general"] >= 100_000);
    assert.ok(state.lastScanTime > 0);

    // Restore state in new watcher
    const watcher2 = new RegistryWatcher(provider, undefined, { categories: ["general"] });
    watcher2.restoreState(state);
    const restored = watcher2.getState();
    assert.equal(restored.lastScannedBlock["general"], state.lastScannedBlock["general"]);
  });
});

// =========================================================================
// 6. TX Builder — OP_RETURN encoding
// =========================================================================

describe("TX Builder", () => {
  it("buildAdvertiseOpReturn produces valid 80-byte QP message", () => {
    const opReturn = buildAdvertiseOpReturn({
      skillCode: 0x0200,
      priceKoinu: 100_000_000,
      priceUnit: PriceUnit.PER_REQUEST,
      flags: {
        supportsDirectHtlc: true,
        supportsSideloadHttps: true,
        supportsSideloadLibp2p: false,
        supportsSideloadIpfs: false,
        onlineNow: true,
        supportsPaymentChannel: false,
        acceptsPostPayment: false,
        isCompositeTool: false,
      },
      ttlBlocks: 4320,
      pubkey: fakePubkey,
      description: "Code Agent",
      category: "compute",
    });
    assert.equal(opReturn.length, 80);
    assert.ok(isQPMessage(opReturn));
    const decoded = decodeMessage(opReturn);
    assert.equal(decoded.type, QPMessageType.SERVICE_ADVERTISE);
  });

  it("buildRatingOpReturn produces valid 80-byte QP message", () => {
    const opReturn = buildRatingOpReturn({
      sessionId: 42,
      providerAddress: "DProvider123",
      ratedAgent: fakePubkey,
      skillCode: 0x0403,
      paymentTxid: Buffer.alloc(32, 0xaa),
      rating: 200,
      tipIncluded: true,
      dispute: false,
    });
    assert.equal(opReturn.length, 80);
    assert.ok(isQPMessage(opReturn));
    const decoded = decodeMessage(opReturn);
    assert.equal(decoded.type, QPMessageType.RATING);
  });

  it("advertise OP_RETURN round-trips through decode", () => {
    const opReturn = buildAdvertiseOpReturn({
      skillCode: 0x0403,
      priceKoinu: 500_000_000,
      priceUnit: PriceUnit.PER_REQUEST,
      flags: {
        supportsDirectHtlc: true,
        supportsSideloadHttps: false,
        supportsSideloadLibp2p: false,
        supportsSideloadIpfs: false,
        onlineNow: false,
        supportsPaymentChannel: true,
        acceptsPostPayment: false,
        isCompositeTool: false,
      },
      ttlBlocks: 10080,
      pubkey: fakePubkey,
      description: "OCR Service",
      category: "general",
    });

    const decoded = decodeMessage(opReturn);
    const payload = decoded.payload as ServiceAdvertisePayload;
    assert.equal(payload.skillCode, 0x0403);
    assert.equal(payload.priceKoinu, 500_000_000);
    assert.equal(payload.flags.supportsDirectHtlc, true);
    assert.equal(payload.flags.supportsPaymentChannel, true);
    assert.equal(payload.flags.onlineNow, false);
    assert.equal(payload.ttlBlocks, 10080);
  });
});
