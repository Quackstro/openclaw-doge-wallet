/**
 * HTLC unit tests — script, transactions, manager lifecycle.
 *
 * Uses Node.js built-in test runner. Imports compiled JS from dist/.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "crypto";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const bitcore = require("bitcore-lib-doge");

// Crypto
import { hash160 } from "../dist/src/qp/crypto.js";

// Script
import {
  buildRedeemScript,
  createHTLC,
  buildClaimScriptSig,
  buildRefundScriptSig,
  parseRedeemScript,
  verifySecret,
  generateSecret,
  hashSecret,
} from "../dist/src/qp/htlc/script.js";

// Transactions
import {
  buildClaimTransaction,
  buildRefundTransaction,
  estimateFee,
  TX_SIZE_ESTIMATES,
} from "../dist/src/qp/htlc/transactions.js";

// Manager
import {
  InMemoryHTLCStorage,
  HTLCProviderManager,
  HTLCConsumerManager,
} from "../dist/src/qp/htlc/manager.js";

// Types
import {
  HTLCState,
  HTLC_DEFAULTS,
} from "../dist/src/qp/htlc/types.js";

import type {
  HTLCParams,
} from "../dist/src/qp/htlc/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKeyPair() {
  const priv = new bitcore.PrivateKey("testnet");
  const pub = Buffer.from(priv.publicKey.toBuffer());
  const addr: string = priv.toAddress("testnet").toString();
  const privBuf = Buffer.from(priv.bn.toBuffer({ size: 32 }));
  return { priv, pub, addr, privBuf };
}

const consumer = makeKeyPair();
const provider = makeKeyPair();

function makeSecret(): { secret: Buffer; secretHash: Buffer } {
  const secret = randomBytes(32);
  const secretHash = hash160(secret);
  return { secret, secretHash };
}

function makeHTLCParams(overrides?: Partial<HTLCParams>): HTLCParams {
  const { secretHash } = makeSecret();
  return {
    secretHash,
    providerPubkey: provider.pub,
    consumerPubkey: consumer.pub,
    timeoutBlock: 200_000,
    ...overrides,
  };
}

// =========================================================================
// 1. Script — redeem script, parsing, scriptSigs
// =========================================================================

describe("HTLC Script", () => {
  it("buildRedeemScript produces 103-byte script", () => {
    const params = makeHTLCParams();
    const script = buildRedeemScript(params);
    assert.equal(script.length, 103);
    // Starts with OP_IF (0x63)
    assert.equal(script[0], 0x63);
    // Ends with OP_ENDIF (0x68)
    assert.equal(script[102], 0x68);
  });

  it("buildRedeemScript rejects bad secret hash length", () => {
    assert.throws(
      () => buildRedeemScript({ ...makeHTLCParams(), secretHash: Buffer.alloc(16) }),
      /Secret hash must be 20 bytes/
    );
  });

  it("buildRedeemScript rejects non-compressed pubkeys", () => {
    assert.throws(
      () => buildRedeemScript({ ...makeHTLCParams(), providerPubkey: Buffer.alloc(65) }),
      /Provider pubkey must be 33 bytes/
    );
    assert.throws(
      () => buildRedeemScript({ ...makeHTLCParams(), consumerPubkey: Buffer.alloc(32) }),
      /Consumer pubkey must be 33 bytes/
    );
  });

  it("buildRedeemScript rejects invalid timeout", () => {
    assert.throws(
      () => buildRedeemScript({ ...makeHTLCParams(), timeoutBlock: 0 }),
      /Timeout block must be positive/
    );
    assert.throws(
      () => buildRedeemScript({ ...makeHTLCParams(), timeoutBlock: -1 }),
      /Timeout block must be positive/
    );
  });

  it("createHTLC returns details with P2SH address", () => {
    const params = makeHTLCParams();
    const htlc = createHTLC(params);
    assert.equal(htlc.redeemScript.length, 103);
    assert.equal(htlc.scriptHash.length, 20);
    assert.ok(htlc.p2shAddress.length > 0);
    assert.ok(htlc.secretHash.equals(params.secretHash));
    assert.ok(htlc.providerPubkey.equals(params.providerPubkey));
    assert.ok(htlc.consumerPubkey.equals(params.consumerPubkey));
    assert.equal(htlc.timeoutBlock, params.timeoutBlock);
  });

  it("createHTLC is deterministic for same params", () => {
    const { secretHash } = makeSecret();
    const params: HTLCParams = {
      secretHash,
      providerPubkey: provider.pub,
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
    };
    const h1 = createHTLC(params);
    const h2 = createHTLC(params);
    assert.ok(h1.redeemScript.equals(h2.redeemScript));
    assert.equal(h1.p2shAddress, h2.p2shAddress);
  });

  it("parseRedeemScript round-trips", () => {
    const { secret, secretHash } = makeSecret();
    const params: HTLCParams = {
      secretHash,
      providerPubkey: provider.pub,
      consumerPubkey: consumer.pub,
      timeoutBlock: 150_000,
    };
    const script = buildRedeemScript(params);
    const parsed = parseRedeemScript(script);
    assert.ok(parsed.secretHash.equals(secretHash));
    assert.ok(parsed.providerPubkey.equals(provider.pub));
    assert.ok(parsed.consumerPubkey.equals(consumer.pub));
    assert.equal(parsed.timeoutBlock, 150_000);
  });

  it("parseRedeemScript rejects bad length", () => {
    assert.throws(
      () => parseRedeemScript(Buffer.alloc(50)),
      /Invalid script length/
    );
  });

  it("parseRedeemScript rejects corrupted script", () => {
    const script = buildRedeemScript(makeHTLCParams());
    const bad = Buffer.from(script);
    bad[0] = 0x00; // Replace OP_IF
    assert.throws(() => parseRedeemScript(bad), /must start with OP_IF/);
  });

  it("buildClaimScriptSig produces valid buffer with OP_TRUE", () => {
    const params = makeHTLCParams();
    const script = buildRedeemScript(params);
    const fakeSig = Buffer.alloc(72, 0x30);
    const secret = randomBytes(32);
    const scriptSig = buildClaimScriptSig(fakeSig, secret, script);
    // Should contain OP_TRUE (0x51) to select IF branch
    assert.ok(scriptSig.includes(Buffer.from([0x51])));
    // Should contain the secret
    assert.ok(scriptSig.includes(secret));
  });

  it("buildClaimScriptSig rejects wrong secret length", () => {
    const script = buildRedeemScript(makeHTLCParams());
    assert.throws(
      () => buildClaimScriptSig(Buffer.alloc(72), Buffer.alloc(16), script),
      /Secret must be 32 bytes/
    );
  });

  it("buildRefundScriptSig produces valid buffer with OP_FALSE", () => {
    const params = makeHTLCParams();
    const script = buildRedeemScript(params);
    const fakeSig = Buffer.alloc(72, 0x30);
    const scriptSig = buildRefundScriptSig(fakeSig, script);
    // Should contain OP_FALSE (0x00) to select ELSE branch
    // OP_FALSE is at position after the signature push
    assert.ok(scriptSig[fakeSig.length + 1] === 0x00);
  });
});

// =========================================================================
// 2. Secret hashing & verification
// =========================================================================

describe("Secret Operations", () => {
  it("generateSecret returns 32 bytes", () => {
    const s = generateSecret();
    assert.equal(s.length, 32);
  });

  it("hashSecret returns 20 bytes (HASH160)", () => {
    const s = generateSecret();
    const h = hashSecret(s);
    assert.equal(h.length, 20);
  });

  it("verifySecret accepts matching secret", () => {
    const secret = generateSecret();
    const hash = hashSecret(secret);
    assert.ok(verifySecret(secret, hash));
  });

  it("verifySecret rejects wrong secret", () => {
    const secret = generateSecret();
    const hash = hashSecret(secret);
    const wrongSecret = randomBytes(32);
    assert.equal(verifySecret(wrongSecret, hash), false);
  });

  it("verifySecret rejects wrong-length secret", () => {
    const hash = hashSecret(generateSecret());
    assert.equal(verifySecret(Buffer.alloc(16), hash), false);
  });

  it("hashSecret matches hash160", () => {
    const secret = generateSecret();
    assert.ok(hashSecret(secret).equals(hash160(secret)));
  });
});

// =========================================================================
// 3. Transactions — claim & refund
// =========================================================================

describe("HTLC Transactions", () => {
  const { secret, secretHash } = makeSecret();
  const params: HTLCParams = {
    secretHash,
    providerPubkey: provider.pub,
    consumerPubkey: consumer.pub,
    timeoutBlock: 200_000,
  };
  const htlc = createHTLC(params);
  const fakeFundingTxId = "b".repeat(64);
  const htlcAmount = 600_000_000; // 6 DOGE
  const fee = 1_000_000; // 0.01 DOGE

  it("buildClaimTransaction produces valid tx", () => {
    const tx = buildClaimTransaction({
      fundingTxId: fakeFundingTxId,
      fundingOutputIndex: 0,
      secret,
      redeemScript: htlc.redeemScript,
      providerPrivkey: provider.privBuf,
      providerAddress: provider.addr,
      htlcAmountKoinu: htlcAmount,
      feeKoinu: fee,
    });
    assert.ok(tx);
    assert.equal(tx.outputs.length, 1);
    assert.equal(tx.outputs[0].satoshis, htlcAmount - fee);
    assert.equal(tx.inputs.length, 1);
  });

  it("buildClaimTransaction rejects if fee exceeds amount", () => {
    assert.throws(
      () => buildClaimTransaction({
        fundingTxId: fakeFundingTxId,
        fundingOutputIndex: 0,
        secret,
        redeemScript: htlc.redeemScript,
        providerPrivkey: provider.privBuf,
        providerAddress: provider.addr,
        htlcAmountKoinu: 500_000,
        feeKoinu: 1_000_000,
      }),
      /too small to cover fees/
    );
  });

  it("buildRefundTransaction produces valid tx with nLockTime", () => {
    const tx = buildRefundTransaction({
      fundingTxId: fakeFundingTxId,
      fundingOutputIndex: 0,
      redeemScript: htlc.redeemScript,
      consumerPrivkey: consumer.privBuf,
      consumerAddress: consumer.addr,
      htlcAmountKoinu: htlcAmount,
      feeKoinu: fee,
      timeoutBlock: params.timeoutBlock,
    });
    assert.ok(tx);
    assert.equal(tx.outputs.length, 1);
    assert.equal(tx.outputs[0].satoshis, htlcAmount - fee);
    assert.equal(tx.nLockTime, params.timeoutBlock);
    // Sequence must be < 0xFFFFFFFF to enable CLTV
    assert.equal(tx.inputs[0].sequenceNumber, 0xFFFFFFFE);
  });

  it("buildRefundTransaction rejects if fee exceeds amount", () => {
    assert.throws(
      () => buildRefundTransaction({
        fundingTxId: fakeFundingTxId,
        fundingOutputIndex: 0,
        redeemScript: htlc.redeemScript,
        consumerPrivkey: consumer.privBuf,
        consumerAddress: consumer.addr,
        htlcAmountKoinu: 500_000,
        feeKoinu: 1_000_000,
        timeoutBlock: params.timeoutBlock,
      }),
      /too small to cover fees/
    );
  });

  it("estimateFee returns reasonable values", () => {
    const claimFee = estimateFee(TX_SIZE_ESTIMATES.CLAIM);
    assert.ok(claimFee > 0);
    // Custom fee rate
    const customFee = estimateFee(250, 50_000_000); // 0.5 DOGE/KB
    assert.equal(customFee, Math.ceil(250 * 50_000_000 / 1000));
  });
});

// =========================================================================
// 4. Manager — Provider
// =========================================================================

describe("HTLCProviderManager", () => {
  let storage: InstanceType<typeof InMemoryHTLCStorage>;
  let pm: InstanceType<typeof HTLCProviderManager>;

  beforeEach(() => {
    storage = new InMemoryHTLCStorage();
    pm = new HTLCProviderManager(storage, provider.pub, provider.privBuf, provider.addr);
  });

  it("createOffer generates secret and HTLC", async () => {
    const { htlc, secret, record } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    assert.equal(secret.length, 32);
    assert.equal(htlc.redeemScript.length, 103);
    assert.equal(record.state, HTLCState.CREATED);
    assert.ok(record.secret);
    assert.equal(record.sessionId, 1);
    assert.equal(record.skillCode, 0x0403);
    // Verify secret matches the hash in the HTLC
    assert.ok(verifySecret(secret, htlc.secretHash));
  });

  it("markFunded transitions to ACTIVE", async () => {
    const { record } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    const funded = await pm.markFunded(record.id, "c".repeat(64), 600_000_000);
    assert.equal(funded.state, HTLCState.ACTIVE);
    assert.equal(funded.fundingTxId, "c".repeat(64));
    assert.equal(funded.amountKoinu, 600_000_000);
  });

  it("claim builds tx and transitions to CLAIMED", async () => {
    const { record } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await pm.markFunded(record.id, "c".repeat(64), 600_000_000);

    const { claimTx, claimTxId, secret } = await pm.claim(record.id);
    assert.ok(claimTx.length > 0);
    assert.ok(claimTxId.length > 0);
    assert.equal(secret.length, 32);

    const final = await storage.load(record.id);
    assert.equal(final?.state, HTLCState.CLAIMED);
    assert.equal(final?.claimTxId, claimTxId);
  });

  it("claim rejects non-ACTIVE HTLC", async () => {
    const { record } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    // Still in CREATED state (not funded)
    await assert.rejects(() => pm.claim(record.id), /not in ACTIVE state/);
  });

  it("getPendingHTLCs returns active and funding_pending", async () => {
    const { record: r1 } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await pm.markFunded(r1.id, "c".repeat(64), 600_000_000);

    const pending = await pm.getPendingHTLCs();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].state, HTLCState.ACTIVE);
  });

  it("checkExpired marks timed-out HTLCs as EXPIRED", async () => {
    const { record } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await pm.markFunded(record.id, "c".repeat(64), 600_000_000);

    // Block before timeout — nothing expired
    const none = await pm.checkExpired(199_999);
    assert.equal(none.length, 0);

    // Block at timeout — should expire
    const expired = await pm.checkExpired(200_000);
    assert.equal(expired.length, 1);
    assert.equal(expired[0].state, HTLCState.EXPIRED);
  });
});

// =========================================================================
// 5. Manager — Consumer
// =========================================================================

describe("HTLCConsumerManager", () => {
  let storage: InstanceType<typeof InMemoryHTLCStorage>;
  let cm: InstanceType<typeof HTLCConsumerManager>;

  beforeEach(() => {
    storage = new InMemoryHTLCStorage();
    cm = new HTLCConsumerManager(storage, consumer.pub, consumer.privBuf, consumer.addr);
  });

  it("acceptOffer creates record with correct state", async () => {
    const { secretHash } = makeSecret();
    const { htlc, record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    assert.equal(record.state, HTLCState.CREATED);
    assert.equal(htlc.redeemScript.length, 103);
    assert.ok(htlc.secretHash.equals(secretHash));
    // Consumer should NOT have the secret
    assert.equal(record.secret, undefined);
  });

  it("markFunded → markActive lifecycle", async () => {
    const { secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });

    const funded = await cm.markFunded(record.id, "d".repeat(64), 600_000_000);
    assert.equal(funded.state, HTLCState.FUNDING_PENDING);

    const active = await cm.markActive(record.id);
    assert.equal(active.state, HTLCState.ACTIVE);
  });

  it("verifyAndMarkClaimed accepts correct secret", async () => {
    const { secret, secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });

    const valid = await cm.verifyAndMarkClaimed(record.id, secret, "e".repeat(64));
    assert.ok(valid);

    const final = await storage.load(record.id);
    assert.equal(final?.state, HTLCState.CLAIMED);
    assert.ok(final?.secret?.equals(secret));
  });

  it("verifyAndMarkClaimed rejects wrong secret", async () => {
    const { secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });

    const wrongSecret = randomBytes(32);
    const valid = await cm.verifyAndMarkClaimed(record.id, wrongSecret, "e".repeat(64));
    assert.equal(valid, false);

    // State should NOT change
    const final = await storage.load(record.id);
    assert.equal(final?.state, HTLCState.CREATED);
  });

  it("buildRefundTx produces valid tx", async () => {
    const { secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await cm.markFunded(record.id, "d".repeat(64), 600_000_000);
    await cm.markActive(record.id);

    const activeRecord = await storage.load(record.id);
    const { refundTx, refundTxId } = cm.buildRefundTx({
      record: activeRecord!,
      feeKoinu: 1_000_000,
    });
    assert.ok(refundTx.length > 0);
    assert.ok(refundTxId.length > 0);
  });

  it("markRefunded transitions to REFUNDED", async () => {
    const { secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await cm.markFunded(record.id, "d".repeat(64), 600_000_000);
    await cm.markActive(record.id);

    const refunded = await cm.markRefunded(record.id, "f".repeat(64));
    assert.equal(refunded.state, HTLCState.REFUNDED);
    assert.equal(refunded.refundTxId, "f".repeat(64));
  });

  it("getRefundableHTLCs returns eligible records", async () => {
    const { secretHash } = makeSecret();
    const { record } = await cm.acceptOffer({
      secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 1,
      skillCode: 0x0403,
    });
    await cm.markFunded(record.id, "d".repeat(64), 600_000_000);
    await cm.markActive(record.id);

    // Before timeout — not refundable
    const none = await cm.getRefundableHTLCs(199_999);
    assert.equal(none.length, 0);

    // At timeout — refundable
    const refundable = await cm.getRefundableHTLCs(200_000);
    assert.equal(refundable.length, 1);
  });
});

// =========================================================================
// 6. Full lifecycle — provider + consumer
// =========================================================================

describe("Full HTLC Lifecycle", () => {
  it("provider creates → consumer funds → provider claims → consumer verifies", async () => {
    const provStorage = new InMemoryHTLCStorage();
    const conStorage = new InMemoryHTLCStorage();
    const pm = new HTLCProviderManager(provStorage, provider.pub, provider.privBuf, provider.addr);
    const cm = new HTLCConsumerManager(conStorage, consumer.pub, consumer.privBuf, consumer.addr);

    // 1. Provider creates offer
    const { htlc, secret, record: provRecord } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 42,
      skillCode: 0x0200,
    });

    // 2. Consumer accepts (gets secretHash from provider, NOT the secret)
    const { record: conRecord } = await cm.acceptOffer({
      secretHash: htlc.secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 42,
      skillCode: 0x0200,
    });

    // Both sides should produce same P2SH address
    assert.equal(conRecord.p2shAddress, provRecord.p2shAddress);

    // 3. Consumer funds (simulated)
    const fakeFundingTxId = "a".repeat(64);
    const amount = 600_000_000;
    await cm.markFunded(conRecord.id, fakeFundingTxId, amount);
    await cm.markActive(conRecord.id);

    // Provider also sees funding
    await pm.markFunded(provRecord.id, fakeFundingTxId, amount);

    // 4. Provider claims
    const { claimTxId, secret: revealedSecret } = await pm.claim(provRecord.id);
    assert.ok(claimTxId.length > 0);

    // 5. Consumer verifies the revealed secret
    const valid = await cm.verifyAndMarkClaimed(conRecord.id, revealedSecret, claimTxId);
    assert.ok(valid);

    // Final states
    const provFinal = await provStorage.load(provRecord.id);
    const conFinal = await conStorage.load(conRecord.id);
    assert.equal(provFinal?.state, HTLCState.CLAIMED);
    assert.equal(conFinal?.state, HTLCState.CLAIMED);
    assert.ok(conFinal?.secret?.equals(secret));
  });

  it("provider fails to deliver → consumer refunds after timeout", async () => {
    const provStorage = new InMemoryHTLCStorage();
    const conStorage = new InMemoryHTLCStorage();
    const pm = new HTLCProviderManager(provStorage, provider.pub, provider.privBuf, provider.addr);
    const cm = new HTLCConsumerManager(conStorage, consumer.pub, consumer.privBuf, consumer.addr);

    // Setup
    const { htlc, record: provRecord } = await pm.createOffer({
      consumerPubkey: consumer.pub,
      timeoutBlock: 200_000,
      sessionId: 99,
      skillCode: 0x0100,
    });
    const { record: conRecord } = await cm.acceptOffer({
      secretHash: htlc.secretHash,
      providerPubkey: provider.pub,
      timeoutBlock: 200_000,
      sessionId: 99,
      skillCode: 0x0100,
    });

    const fakeFundingTxId = "b".repeat(64);
    const amount = 500_000_000;
    await cm.markFunded(conRecord.id, fakeFundingTxId, amount);
    await cm.markActive(conRecord.id);
    await pm.markFunded(provRecord.id, fakeFundingTxId, amount);

    // Provider never claims... timeout passes
    const expired = await pm.checkExpired(200_001);
    assert.equal(expired.length, 1);

    // Consumer builds refund tx
    const refundable = await cm.getRefundableHTLCs(200_001);
    assert.equal(refundable.length, 1);

    const { refundTx, refundTxId } = cm.buildRefundTx({
      record: refundable[0],
      feeKoinu: 1_000_000,
    });
    assert.ok(refundTx.length > 0);

    await cm.markRefunded(conRecord.id, refundTxId);
    const conFinal = await conStorage.load(conRecord.id);
    assert.equal(conFinal?.state, HTLCState.REFUNDED);
  });
});

// =========================================================================
// 7. InMemoryHTLCStorage
// =========================================================================

describe("InMemoryHTLCStorage", () => {
  it("save/load round-trips", async () => {
    const storage = new InMemoryHTLCStorage();
    const { secretHash } = makeSecret();
    const record = {
      id: "test-1",
      state: HTLCState.CREATED as HTLCState,
      params: { secretHash, providerPubkey: provider.pub, consumerPubkey: consumer.pub, timeoutBlock: 100 },
      redeemScript: Buffer.alloc(103),
      p2shAddress: "test-address",
      sessionId: 1,
      skillCode: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.save(record);
    const loaded = await storage.load("test-1");
    assert.equal(loaded?.id, "test-1");
    assert.equal(loaded?.state, HTLCState.CREATED);
  });

  it("loadByFundingTx finds record", async () => {
    const storage = new InMemoryHTLCStorage();
    const { secretHash } = makeSecret();
    const record = {
      id: "test-2",
      state: HTLCState.ACTIVE as HTLCState,
      params: { secretHash, providerPubkey: provider.pub, consumerPubkey: consumer.pub, timeoutBlock: 100 },
      redeemScript: Buffer.alloc(103),
      p2shAddress: "test-address",
      fundingTxId: "abc123",
      sessionId: 1,
      skillCode: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.save(record);
    const found = await storage.loadByFundingTx("abc123");
    assert.equal(found?.id, "test-2");
    const notFound = await storage.loadByFundingTx("xyz");
    assert.equal(notFound, null);
  });

  it("loadByState filters correctly", async () => {
    const storage = new InMemoryHTLCStorage();
    const { secretHash } = makeSecret();
    const base = {
      params: { secretHash, providerPubkey: provider.pub, consumerPubkey: consumer.pub, timeoutBlock: 100 },
      redeemScript: Buffer.alloc(103),
      p2shAddress: "test",
      sessionId: 1,
      skillCode: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await storage.save({ ...base, id: "a", state: HTLCState.ACTIVE });
    await storage.save({ ...base, id: "b", state: HTLCState.ACTIVE });
    await storage.save({ ...base, id: "c", state: HTLCState.CLAIMED });

    const active = await storage.loadByState(HTLCState.ACTIVE);
    assert.equal(active.length, 2);
    const claimed = await storage.loadByState(HTLCState.CLAIMED);
    assert.equal(claimed.length, 1);
  });

  it("delete removes record", async () => {
    const storage = new InMemoryHTLCStorage();
    const { secretHash } = makeSecret();
    await storage.save({
      id: "del-me",
      state: HTLCState.CREATED,
      params: { secretHash, providerPubkey: provider.pub, consumerPubkey: consumer.pub, timeoutBlock: 100 },
      redeemScript: Buffer.alloc(103),
      p2shAddress: "test",
      sessionId: 1,
      skillCode: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    assert.ok(await storage.load("del-me"));
    await storage.delete("del-me");
    assert.equal(await storage.load("del-me"), null);
  });
});
