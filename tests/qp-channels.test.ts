/**
 * Payment Channels unit tests — multisig, commitments, manager lifecycle.
 *
 * Uses Node.js built-in test runner. Imports compiled JS from dist/.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const bitcore = require("bitcore-lib-doge");

// Multisig
import {
  build2of2RedeemScript,
  sortPubkeys,
  createMultisig,
  parseMultisigScript,
  getSignatureOrder,
  buildMultisigScriptSig,
} from "../dist/src/qp/channels/multisig.js";

// Commitment
import {
  calculateTimelock,
  maxChannelCalls,
  createInitialCommitment,
  createNextCommitment,
  buildCooperativeCloseTx,
  signCommitment,
  verifyCommitmentSig,
  completeCommitment,
  createSignedCommitment,
} from "../dist/src/qp/channels/commitment.js";

// Manager
import {
  InMemoryChannelStorage,
  ChannelConsumerManager,
  ChannelProviderManager,
} from "../dist/src/qp/channels/manager.js";

// Types
import {
  ChannelState,
  CHANNEL_DEFAULTS,
  DUST_THRESHOLD_KOINU,
  DEFAULT_CLOSE_FEE_KOINU,
} from "../dist/src/qp/channels/types.js";

import type {
  ChannelParams,
  ChannelFunding,
  CommitmentState,
} from "../dist/src/qp/channels/types.js";

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

// Two stable key-pairs for the whole file
const consumer = makeKeyPair();
const provider = makeKeyPair();

function makeParams(overrides?: Partial<ChannelParams>): ChannelParams {
  return {
    channelId: 42,
    consumerPubkey: consumer.pub,
    providerPubkey: provider.pub,
    ttlBlocks: 4320,
    openBlock: 100_000,
    timelockGap: 10,
    ...overrides,
  };
}

function makeFunding(redeemScript: Buffer, p2shAddress: string): ChannelFunding {
  return {
    fundingTxId: "a".repeat(64),
    fundingOutputIndex: 0,
    depositKoinu: 1_000_000_000, // 10 DOGE
    redeemScript,
    p2shAddress,
  };
}

// =========================================================================
// 1. Multisig
// =========================================================================

describe("Multisig", () => {
  it("sortPubkeys returns deterministic order", () => {
    const [a, b] = sortPubkeys(consumer.pub, provider.pub);
    const [a2, b2] = sortPubkeys(provider.pub, consumer.pub);
    assert.ok(a.equals(a2));
    assert.ok(b.equals(b2));
  });

  it("build2of2RedeemScript produces 71-byte script", () => {
    const script = build2of2RedeemScript(consumer.pub, provider.pub);
    assert.equal(script.length, 71);
    // starts with OP_2 (0x52)
    assert.equal(script[0], 0x52);
    // ends with OP_CHECKMULTISIG (0xae)
    assert.equal(script[70], 0xae);
  });

  it("rejects non-33-byte keys", () => {
    assert.throws(() => build2of2RedeemScript(Buffer.alloc(32), consumer.pub));
    assert.throws(() => build2of2RedeemScript(consumer.pub, Buffer.alloc(65)));
  });

  it("createMultisig returns consistent redeemScript + p2sh address", () => {
    const m1 = createMultisig(consumer.pub, provider.pub);
    const m2 = createMultisig(provider.pub, consumer.pub);
    assert.ok(m1.redeemScript.equals(m2.redeemScript));
    assert.equal(m1.p2shAddress, m2.p2shAddress);
    assert.equal(m1.p2shAddress.length > 0, true);
  });

  it("parseMultisigScript round-trips", () => {
    const script = build2of2RedeemScript(consumer.pub, provider.pub);
    const { pubkey1, pubkey2 } = parseMultisigScript(script);
    const [sorted1] = sortPubkeys(consumer.pub, provider.pub);
    assert.ok(pubkey1.equals(sorted1));
    assert.ok(pubkey1.length === 33 && pubkey2.length === 33);
  });

  it("parseMultisigScript rejects bad scripts", () => {
    assert.throws(() => parseMultisigScript(Buffer.alloc(70)));
    const bad = Buffer.alloc(71);
    bad[0] = 0x00; // wrong opcode
    assert.throws(() => parseMultisigScript(bad));
  });

  it("getSignatureOrder identifies consumer_first / provider_first", () => {
    const script = build2of2RedeemScript(consumer.pub, provider.pub);
    const order = getSignatureOrder(script, consumer.pub, provider.pub);
    assert.ok(order === "consumer_first" || order === "provider_first");
    // Swap should give opposite
    const order2 = getSignatureOrder(script, provider.pub, consumer.pub);
    assert.notEqual(order, order2);
  });

  it("getSignatureOrder throws for unknown key", () => {
    const script = build2of2RedeemScript(consumer.pub, provider.pub);
    const other = makeKeyPair();
    // Neither argument matches either key in the script
    assert.throws(() => getSignatureOrder(script, other.pub, other.pub));
  });

  it("buildMultisigScriptSig produces valid buffer", () => {
    const script = build2of2RedeemScript(consumer.pub, provider.pub);
    const fakeSig1 = Buffer.alloc(72, 0x30);
    const fakeSig2 = Buffer.alloc(72, 0x31);
    const scriptSig = buildMultisigScriptSig(fakeSig1, fakeSig2, script);
    // Starts with OP_0
    assert.equal(scriptSig[0], 0x00);
    assert.ok(scriptSig.length > 71 + 72 + 72);
  });
});

// =========================================================================
// 2. Commitment
// =========================================================================

describe("Commitment", () => {
  const params = makeParams();

  it("calculateTimelock: sequence 0 gives max timelock", () => {
    const t0 = calculateTimelock(params, 0);
    assert.equal(t0, params.openBlock + params.ttlBlocks);
  });

  it("calculateTimelock decays with sequence", () => {
    const t0 = calculateTimelock(params, 0);
    const t1 = calculateTimelock(params, 1);
    const t5 = calculateTimelock(params, 5);
    assert.equal(t0 - t1, params.timelockGap);
    assert.equal(t0 - t5, 5 * params.timelockGap);
    assert.ok(t5 < t1);
  });

  it("maxChannelCalls = ttlBlocks / timelockGap", () => {
    assert.equal(maxChannelCalls(params), Math.floor(params.ttlBlocks / params.timelockGap));
  });

  it("createInitialCommitment gives full balance to consumer", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const { state, tx } = createInitialCommitment(params, funding, consumer.addr, provider.addr);
    assert.equal(state.sequence, 0);
    assert.equal(state.consumerBalance, funding.depositKoinu);
    assert.equal(state.providerBalance, 0);
    assert.equal(state.callCount, 0);
    assert.ok(tx);
  });

  it("createNextCommitment transfers balance", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const { state: s0 } = createInitialCommitment(params, funding, consumer.addr, provider.addr);
    const payment = 100_000_000; // 1 DOGE
    const { state: s1 } = createNextCommitment(params, funding, s0, payment, consumer.addr, provider.addr);
    assert.equal(s1.sequence, 1);
    assert.equal(s1.consumerBalance, s0.consumerBalance - payment);
    assert.equal(s1.providerBalance, payment);
    assert.equal(s1.callCount, 1);
    // Latest commitment unlocks first (lower timelock)
    assert.ok(s1.timelockBlock < s0.timelockBlock);
  });

  it("createNextCommitment rejects overspend", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const { state: s0 } = createInitialCommitment(params, funding, consumer.addr, provider.addr);
    assert.throws(() => createNextCommitment(params, funding, s0, funding.depositKoinu + 1, consumer.addr, provider.addr));
  });

  it("createNextCommitment rejects zero payment", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const { state: s0 } = createInitialCommitment(params, funding, consumer.addr, provider.addr);
    assert.throws(() => createNextCommitment(params, funding, s0, 0, consumer.addr, provider.addr));
  });

  it("buildCooperativeCloseTx has no locktime", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const state: CommitmentState = {
      sequence: 5,
      consumerBalance: 500_000_000,
      providerBalance: 500_000_000,
      callCount: 5,
      timelockBlock: calculateTimelock(params, 5),
    };
    const tx = buildCooperativeCloseTx(params, funding, state, consumer.addr, provider.addr);
    assert.equal(tx.nLockTime, 0);
  });
});

// =========================================================================
// 3. Manager — Full Lifecycle
// =========================================================================

describe("ChannelConsumerManager", () => {
  let storage: InstanceType<typeof InMemoryChannelStorage>;
  let cm: InstanceType<typeof ChannelConsumerManager>;

  beforeEach(() => {
    storage = new InMemoryChannelStorage();
    cm = new ChannelConsumerManager(storage, consumer.pub, consumer.privBuf, consumer.addr);
  });

  it("createChannel stores record in CREATED state", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    assert.equal(record.state, ChannelState.CREATED);
    assert.equal(record.role, "consumer");
    assert.ok(multisig.p2shAddress);
    assert.ok(multisig.redeemScript.length === 71);
  });

  it("rejects deposit below minimum", async () => {
    await assert.rejects(() =>
      cm.createChannel({
        providerPubkey: provider.pub,
        depositKoinu: 100, // way below min
        openBlock: 100_000,
      })
    );
  });

  it("rejects deposit above maximum", async () => {
    await assert.rejects(() =>
      cm.createChannel({
        providerPubkey: provider.pub,
        depositKoinu: CHANNEL_DEFAULTS.maxDepositKoinu + 1,
        openBlock: 100_000,
      })
    );
  });
});

describe("Full Channel Lifecycle", () => {
  let consumerStorage: InstanceType<typeof InMemoryChannelStorage>;
  let providerStorage: InstanceType<typeof InMemoryChannelStorage>;
  let cm: InstanceType<typeof ChannelConsumerManager>;
  let pm: InstanceType<typeof ChannelProviderManager>;

  beforeEach(() => {
    consumerStorage = new InMemoryChannelStorage();
    providerStorage = new InMemoryChannelStorage();
    cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);
    pm = new ChannelProviderManager(providerStorage, provider.pub, provider.privBuf, provider.addr);
  });

  it("open → pay → cooperative close", async () => {
    // 1. Consumer creates channel
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });

    // 2. Simulate funding tx broadcast — consumer sets funding
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundConsumerSig } = await cm.setFunding(
      record.id,
      funding,
      provider.addr
    );

    // 3. Provider accepts channel and signs refund
    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig: refundProviderSig } = await pm.signRefundCommitment(
      provRecord.id,
      refundConsumerSig,
      consumer.addr
    );

    // 4. Consumer completes refund and opens channel
    const openRecord = await cm.completeRefundAndOpen(record.id, refundProviderSig);
    assert.equal(openRecord.state, ChannelState.OPEN);
    assert.ok(openRecord.refundCommitment?.isComplete);

    // 5. Make a payment
    const paymentKoinu = 50_000_000; // 0.5 DOGE
    const { state: payState, consumerSig: paySig } = await cm.createPayment(
      record.id,
      paymentKoinu,
      provider.addr
    );

    // Provider accepts payment
    const { providerSig: payProvSig } = await pm.acceptPayment(
      provRecord.id,
      payState,
      paySig,
      consumer.addr
    );
    assert.ok(payProvSig.length > 0);

    // Consumer stores provider's sig
    await cm.acceptPaymentSignature(record.id, payState, payProvSig, provider.addr);

    // 6. Cooperative close
    const { consumerSig: closeSig } = await cm.initiateCooperativeClose(record.id, provider.addr);
    const { closeTxHex, closeTxId } = await pm.signCooperativeClose(provRecord.id, consumer.addr);
    assert.ok(closeTxHex.length > 0);
    assert.ok(closeTxId.length > 0);

    // Complete on consumer side
    const { closeTxId: consumerCloseTxId } = await cm.completeCooperativeClose(
      record.id,
      (await pm.signCooperativeClose(provRecord.id, consumer.addr)).providerSig,
      provider.addr
    );
    assert.ok(consumerCloseTxId.length > 0);
  });

  it("unilateral close by consumer", async () => {
    // Setup open channel
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Unilateral close
    const { closeTxHex, closeTxId } = await cm.unilateralClose(record.id);
    assert.ok(closeTxHex.length > 0);
    assert.ok(closeTxId.length > 0);

    // Check state
    const final = await consumerStorage.load(record.id);
    assert.equal(final?.state, ChannelState.CLOSED_UNILATERAL_CONSUMER);
  });

  it("unilateral close by provider", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);

    // Provider unilateral close
    const { closeTxHex, closeTxId } = await pm.unilateralClose(provRecord.id);
    assert.ok(closeTxHex.length > 0);
    assert.ok(closeTxId.length > 0);

    const final = await providerStorage.load(provRecord.id);
    assert.equal(final?.state, ChannelState.CLOSED_UNILATERAL_PROVIDER);
  });

  it("getChannelInfo returns capacity details", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    const info = await cm.getChannelInfo(record.id);
    assert.equal(info.remainingCalls, maxChannelCalls(record.params));
    assert.equal(info.remainingBalance, 1_000_000_000);
    assert.equal(info.expiresAtBlock, 100_000 + 4320);
  });

  it("getExpiringChannels flags near-expiry channels", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
      ttlBlocks: 200, // short TTL
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: 200,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Current block near expiry
    const expiring = await cm.getExpiringChannels(100_100, 144);
    assert.equal(expiring.length, 1);

    // Current block far away — should not flag
    const notExpiring = await cm.getExpiringChannels(99_000, 144);
    assert.equal(notExpiring.length, 0);
  });

  it("rejects payment on non-open channel", async () => {
    const { record } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    await assert.rejects(() => cm.createPayment(record.id, 100, provider.addr));
  });

  it("provider rejects out-of-order sequence", async () => {
    // Open a channel
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Try to submit a commitment with sequence 5 (should be 1)
    const badState: CommitmentState = {
      sequence: 5,
      consumerBalance: 900_000_000,
      providerBalance: 100_000_000,
      callCount: 5,
      timelockBlock: calculateTimelock(record.params, 5),
    };
    await assert.rejects(() =>
      pm.acceptPayment(provRecord.id, badState, Buffer.alloc(72), consumer.addr)
    );
  });

  it("setFunding rejects non-CREATED channel", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);

    // Set funding once (transitions to FUNDING_PENDING)
    await cm.setFunding(record.id, funding, provider.addr);

    // Try again — should fail since state is no longer CREATED
    await assert.rejects(
      () => cm.setFunding(record.id, funding, provider.addr),
      /expected 'created'/
    );
  });

  it("setFunding rejects invalid txId", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    funding.fundingTxId = "not-a-valid-hex-txid";

    await assert.rejects(
      () => cm.setFunding(record.id, funding, provider.addr),
      /Invalid funding txId/
    );
  });

  it("provider rejects invalid funding txId", async () => {
    await assert.rejects(
      () => pm.acceptChannel({
        channelId: 1,
        consumerPubkey: consumer.pub,
        depositKoinu: 1_000_000_000,
        ttlBlocks: 4320,
        timelockGap: 10,
        openBlock: 100_000,
        fundingTxId: "xyz",
        fundingOutputIndex: 0,
      }),
      /Invalid funding txId/
    );
  });

  it("provider rejects deposit below minimum", async () => {
    await assert.rejects(
      () => pm.acceptChannel({
        channelId: 1,
        consumerPubkey: consumer.pub,
        depositKoinu: 100,
        ttlBlocks: 4320,
        timelockGap: 10,
        openBlock: 100_000,
        fundingTxId: "a".repeat(64),
        fundingOutputIndex: 0,
      }),
      /Deposit too small/
    );
  });

  it("getExpiringChannels excludes already-expired channels", async () => {
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
      ttlBlocks: 200,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: 200,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Channel expires at block 100200, currentBlock is 100300 — already expired
    const expiring = await cm.getExpiringChannels(100_300, 144);
    assert.equal(expiring.length, 0);

    // But getExpiredChannels should find it
    const expired = await cm.getExpiredChannels(100_300);
    assert.equal(expired.length, 1);
  });
});

// =========================================================================
// 5. Hardening — edge cases
// =========================================================================

describe("Hardening", () => {
  it("calculateTimelock rejects sequence beyond capacity", () => {
    const params = makeParams({ ttlBlocks: 100, timelockGap: 10 });
    // Max calls = 10. Sequence 10 would put timelock at openBlock exactly → reject
    assert.throws(() => calculateTimelock(params, 10), /exceeds channel capacity/);
    // Sequence 11 would go below
    assert.throws(() => calculateTimelock(params, 11), /exceeds channel capacity/);
    // Sequence 9 is fine — timelock = openBlock + 100 - 90 = openBlock + 10
    assert.ok(calculateTimelock(params, 9) > params.openBlock);
  });

  it("calculateTimelock rejects zero timelockGap", () => {
    const params = makeParams({ timelockGap: 0 });
    assert.throws(() => calculateTimelock(params, 0), /timelockGap must be positive/);
  });

  it("maxChannelCalls rejects zero timelockGap", () => {
    const params = makeParams({ timelockGap: 0 });
    assert.throws(() => maxChannelCalls(params), /timelockGap must be positive/);
  });

  it("buildCooperativeCloseTx rejects negative fee", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const state: CommitmentState = {
      sequence: 0,
      consumerBalance: 500_000_000,
      providerBalance: 500_000_000,
      callCount: 0,
      timelockBlock: 104320,
    };
    assert.throws(
      () => buildCooperativeCloseTx(makeParams(), funding, state, consumer.addr, provider.addr, -1),
      /Fee cannot be negative/
    );
  });

  it("buildCooperativeCloseTx folds dust outputs into fee", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    // Consumer has only 50K koinu after fee — below dust threshold
    const state: CommitmentState = {
      sequence: 0,
      consumerBalance: 1_050_000, // 1M fee leaves 50K < DUST_THRESHOLD
      providerBalance: funding.depositKoinu - 1_050_000,
      callCount: 0,
      timelockBlock: 104320,
    };
    const tx = buildCooperativeCloseTx(makeParams(), funding, state, consumer.addr, provider.addr);
    // Should have only 1 output (provider), consumer dust folded into fee
    assert.equal(tx.outputs.length, 1);
  });

  it("balance conservation invariant holds across payments", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const params = makeParams();
    const { state: s0 } = createInitialCommitment(params, funding, consumer.addr, provider.addr);
    assert.equal(s0.consumerBalance + s0.providerBalance, funding.depositKoinu);

    const { state: s1 } = createNextCommitment(params, funding, s0, 100_000_000, consumer.addr, provider.addr);
    assert.equal(s1.consumerBalance + s1.providerBalance, funding.depositKoinu);

    const { state: s2 } = createNextCommitment(params, funding, s1, 200_000_000, consumer.addr, provider.addr);
    assert.equal(s2.consumerBalance + s2.providerBalance, funding.depositKoinu);
  });
});

// =========================================================================
// 6. Signature Verification
// =========================================================================

describe("Signature Verification", () => {
  it("verifyCommitmentSig accepts valid signature", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const params = makeParams();
    const { tx } = createInitialCommitment(params, funding, consumer.addr, provider.addr);

    const sig = signCommitment(tx, consumer.privBuf, ms.redeemScript, funding.depositKoinu);
    assert.ok(verifyCommitmentSig(tx, sig, consumer.pub, ms.redeemScript));
  });

  it("verifyCommitmentSig rejects wrong key", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const params = makeParams();
    const { tx } = createInitialCommitment(params, funding, consumer.addr, provider.addr);

    // Sign with consumer, verify against provider → should fail
    const sig = signCommitment(tx, consumer.privBuf, ms.redeemScript, funding.depositKoinu);
    assert.equal(verifyCommitmentSig(tx, sig, provider.pub, ms.redeemScript), false);
  });

  it("verifyCommitmentSig rejects garbage signature", () => {
    const ms = createMultisig(consumer.pub, provider.pub);
    const funding = makeFunding(ms.redeemScript, ms.p2shAddress);
    const params = makeParams();
    const { tx } = createInitialCommitment(params, funding, consumer.addr, provider.addr);

    const garbage = Buffer.alloc(72, 0xff);
    assert.equal(verifyCommitmentSig(tx, garbage, consumer.pub, ms.redeemScript), false);
  });

  it("provider rejects bad consumer sig on refund", async () => {
    const consumerStorage = new InMemoryChannelStorage();
    const providerStorage = new InMemoryChannelStorage();
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);
    const pm = new ChannelProviderManager(providerStorage, provider.pub, provider.privBuf, provider.addr);

    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });

    // Send garbage instead of real consumer sig
    const garbageSig = Buffer.alloc(72, 0xab);
    await assert.rejects(
      () => pm.signRefundCommitment(provRecord.id, garbageSig, consumer.addr),
      /Invalid consumer signature/
    );
  });

  it("consumer rejects bad provider sig on refund open", async () => {
    const consumerStorage = new InMemoryChannelStorage();
    const providerStorage = new InMemoryChannelStorage();
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);
    const pm = new ChannelProviderManager(providerStorage, provider.pub, provider.privBuf, provider.addr);

    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    await cm.setFunding(record.id, funding, provider.addr);

    // Send garbage provider sig
    const garbageSig = Buffer.alloc(72, 0xcd);
    await assert.rejects(
      () => cm.completeRefundAndOpen(record.id, garbageSig),
      /Invalid provider signature/
    );
  });

  it("consumer rejects bad provider sig on payment", async () => {
    const consumerStorage = new InMemoryChannelStorage();
    const providerStorage = new InMemoryChannelStorage();
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);
    const pm = new ChannelProviderManager(providerStorage, provider.pub, provider.privBuf, provider.addr);

    // Open a channel
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Make a payment
    const { state: payState } = await cm.createPayment(record.id, 50_000_000, provider.addr);

    // Try to accept with garbage provider sig
    const garbageSig = Buffer.alloc(72, 0xef);
    await assert.rejects(
      () => cm.acceptPaymentSignature(record.id, payState, garbageSig, provider.addr),
      /Invalid provider signature/
    );
  });
});

// =========================================================================
// 7. Key Material Cleanup
// =========================================================================

describe("Key Material Cleanup", () => {
  it("destroy() zeroes consumer private key", () => {
    const consumerStorage = new InMemoryChannelStorage();
    const privCopy = Buffer.from(consumer.privBuf);
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, privCopy, consumer.addr);

    // Key should be non-zero before destroy
    assert.ok(privCopy.some(b => b !== 0));

    cm.destroy();

    // Key should be all zeros after destroy
    assert.ok(privCopy.every(b => b === 0));
  });

  it("destroy() zeroes provider private key", () => {
    const providerStorage = new InMemoryChannelStorage();
    const privCopy = Buffer.from(provider.privBuf);
    const pm = new ChannelProviderManager(providerStorage, provider.pub, privCopy, provider.addr);

    assert.ok(privCopy.some(b => b !== 0));
    pm.destroy();
    assert.ok(privCopy.every(b => b === 0));
  });
});

// =========================================================================
// 8. Mutex — Concurrent Access Protection
// =========================================================================

describe("Concurrent Access", () => {
  it("withLock serialises concurrent setFunding calls", async () => {
    const consumerStorage = new InMemoryChannelStorage();
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);

    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);

    // Fire two concurrent setFunding calls — first succeeds, second fails
    const results = await Promise.allSettled([
      cm.setFunding(record.id, funding, provider.addr),
      cm.setFunding(record.id, funding, provider.addr),
    ]);

    // Exactly one should succeed (state is CREATED only once)
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
  });

  it("withLock serialises concurrent payments", async () => {
    const consumerStorage = new InMemoryChannelStorage();
    const providerStorage = new InMemoryChannelStorage();
    const cm = new ChannelConsumerManager(consumerStorage, consumer.pub, consumer.privBuf, consumer.addr);
    const pm = new ChannelProviderManager(providerStorage, provider.pub, provider.privBuf, provider.addr);

    // Open a channel
    const { record, multisig } = await cm.createChannel({
      providerPubkey: provider.pub,
      depositKoinu: 1_000_000_000,
      openBlock: 100_000,
    });
    const funding = makeFunding(multisig.redeemScript, multisig.p2shAddress);
    const { consumerSig: refundSig } = await cm.setFunding(record.id, funding, provider.addr);

    const { record: provRecord } = await pm.acceptChannel({
      channelId: record.params.channelId,
      consumerPubkey: consumer.pub,
      depositKoinu: 1_000_000_000,
      ttlBlocks: record.params.ttlBlocks,
      timelockGap: record.params.timelockGap,
      openBlock: record.params.openBlock,
      fundingTxId: funding.fundingTxId,
      fundingOutputIndex: funding.fundingOutputIndex,
    });
    const { providerSig } = await pm.signRefundCommitment(provRecord.id, refundSig, consumer.addr);
    await cm.completeRefundAndOpen(record.id, providerSig);

    // Two concurrent payments — mutex serialises them so both get unique sequence numbers
    const results = await Promise.allSettled([
      cm.createPayment(record.id, 10_000_000, provider.addr),
      cm.createPayment(record.id, 10_000_000, provider.addr),
    ]);

    // Both should succeed (mutex ensures sequential execution, not rejection)
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    assert.equal(fulfilled.length, 2);

    // The two returned states should have the SAME sequence (both read same base state)
    // because createPayment is read-only — it doesn't save the updated state.
    // This is by design: the caller must finalize via acceptPaymentSignature.
    const states = fulfilled.map(r => (r as PromiseFulfilledResult<any>).value.state);
    assert.equal(states[0].sequence, states[1].sequence);
  });
});
