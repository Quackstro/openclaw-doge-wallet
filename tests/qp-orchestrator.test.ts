/**
 * QP Orchestrator Tests
 * Tests for QPClient and QPProvider
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';

import { QPClient } from '../dist/src/qp/orchestrator/client.js';
import { QPProvider } from '../dist/src/qp/orchestrator/provider.js';
import { CallState } from '../dist/src/qp/orchestrator/types.js';
import { ServiceDirectory } from '../dist/src/qp/chain/registry-watcher.js';
import { QPMessageType, QP_MAGIC, QP_VERSION, PriceUnit } from '../dist/src/qp/types.js';
import { encodeMessage } from '../dist/src/qp/messages.js';
import { generateEphemeralKeyPair } from '../dist/src/qp/crypto.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { PrivateKey } = bitcore;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Generate a test keypair with valid DOGE address */
function makeAgent() {
  const key = new PrivateKey();
  return {
    privkey: key.toBuffer() as Buffer,
    pubkey: key.publicKey.toBuffer() as Buffer,
    address: key.toAddress().toString() as string,
  };
}

/** Mock DogeApiProvider */
function mockProvider(overrides: Partial<any> = {}) {
  const broadcastLog: string[] = [];

  return {
    name: 'mock',
    broadcastLog,
    getBalance: async () => 1_000_000_000_000,
    getTransactions: async () => [],
    getUtxos: async () => [],
    broadcastTx: async (txHex: string) => {
      broadcastLog.push(txHex);
      return { txid: randomBytes(32).toString('hex') };
    },
    getNetworkInfo: async () => ({
      height: 500_000,
      feeEstimate: { high: 1_000_000, medium: 500_000, low: 100_000 },
    }),
    ...overrides,
  };
}

/** Make UTXO array with specified total */
function makeUtxos(totalKoinu: number, count = 1) {
  const perUtxo = Math.floor(totalKoinu / count);
  return Array.from({ length: count }, (_, i) => ({
    txid: randomBytes(32).toString('hex'),
    vout: 0,
    amount: i === count - 1 ? totalKoinu - perUtxo * (count - 1) : perUtxo,
    scriptPubKey: '76a914' + randomBytes(20).toString('hex') + '88ac',
    confirmations: 10,
  }));
}

/** Make a mock ServiceListing */
function makeListing(provider: ReturnType<typeof makeAgent>, skillCode = 0x0403, priceKoinu = 500_000_000) {
  return {
    txid: randomBytes(32).toString('hex'),
    providerAddress: provider.address,
    providerPubkey: provider.pubkey,
    skillCode,
    priceKoinu,
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
    ttlBlocks: 10080,
    description: 'Test service',
    blockHeight: 499_900,
    confirmations: 100,
    expiresAtBlock: 509_980,
  };
}

// ---------------------------------------------------------------------------
// QPClient Tests
// ---------------------------------------------------------------------------

describe('QPClient', () => {
  let consumer: ReturnType<typeof makeAgent>;
  let provider: ReturnType<typeof mockProvider>;

  beforeEach(() => {
    consumer = makeAgent();
    provider = mockProvider();
  });

  it('constructs without error', () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: consumer.privkey,
      provider: provider as any,
      getUtxos: async () => makeUtxos(10_000_000_000),
      changeAddress: consumer.address,
    });
    assert.ok(client);
    client.destroy();
  });

  it('destroy zeroes private key', () => {
    const privCopy = Buffer.from(consumer.privkey);
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: privCopy,
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    assert.ok(privCopy.some(b => b !== 0));
    client.destroy();
    assert.ok(privCopy.every(b => b === 0));
  });

  it('throws after destroy', async () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });
    client.destroy();

    await assert.rejects(
      () => client.discoverProviders(0x0403),
      /destroyed/,
    );
  });

  it('discoverProviders returns empty when no listings', async () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    const results = await client.discoverProviders(0x0403);
    assert.equal(results.length, 0);
    client.destroy();
  });

  it('discoverProviders finds pre-loaded listings', async () => {
    const provAgent = makeAgent();
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    // Pre-load a listing into the directory
    const directory = client.getDirectory();
    const listing = makeListing(provAgent, 0x0403, 500_000_000);
    directory.add(listing);

    const results = await client.discoverProviders(0x0403);
    assert.equal(results.length, 1);
    assert.equal(results[0].skillCode, 0x0403);
    assert.equal(results[0].priceKoinu, 500_000_000);
    client.destroy();
  });

  it('discoverProviders filters by max price', async () => {
    const provAgent = makeAgent();
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    const directory = client.getDirectory();
    directory.add(makeListing(provAgent, 0x0403, 500_000_000));
    directory.add(makeListing(makeAgent(), 0x0403, 1_000_000_000));

    // Filter: max 600M koinu
    const results = await client.discoverProviders(0x0403, 600_000_000);
    assert.equal(results.length, 1);
    assert.equal(results[0].priceKoinu, 500_000_000);
    client.destroy();
  });

  it('discoverProviders sorts by price ascending', async () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    const directory = client.getDirectory();
    directory.add(makeListing(makeAgent(), 0x0403, 800_000_000));
    directory.add(makeListing(makeAgent(), 0x0403, 200_000_000));
    directory.add(makeListing(makeAgent(), 0x0403, 500_000_000));

    const results = await client.discoverProviders(0x0403);
    assert.equal(results.length, 3);
    assert.equal(results[0].priceKoinu, 200_000_000);
    assert.equal(results[1].priceKoinu, 500_000_000);
    assert.equal(results[2].priceKoinu, 800_000_000);
    client.destroy();
  });

  it('discoverProviders filters out self', async () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    const directory = client.getDirectory();
    // Add listing from self — should be excluded
    directory.add({
      ...makeListing(makeAgent(), 0x0403),
      providerAddress: consumer.address,
    });
    directory.add(makeListing(makeAgent(), 0x0403));

    const results = await client.discoverProviders(0x0403);
    assert.equal(results.length, 1);
    assert.notEqual(results[0].providerAddress, consumer.address);
    client.destroy();
  });

  it('emits events via wildcard listener', async () => {
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => [],
      changeAddress: consumer.address,
    });

    const events: any[] = [];
    client.on('*', (evt: any) => events.push(evt));

    // callService will fail at discovery (no providers) — but should emit events
    await assert.rejects(
      () => client.callService(
        {
          skillCode: 0x0403,
          maxPriceKoinu: 1_000_000_000,
          payload: { task: 'test' },
        },
        { send: async () => {}, receive: async () => Buffer.alloc(0), close: async () => {} },
      ),
      /No providers found/,
    );

    // Should have state_change to DISCOVERING and error event
    assert.ok(events.some(e => e.state === CallState.DISCOVERING), 'should emit DISCOVERING state');
    assert.ok(events.some(e => e.state === CallState.FAILED), 'should emit FAILED state');
    client.destroy();
  });

  it('rateProvider broadcasts a rating tx', async () => {
    const prov = makeAgent();
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => makeUtxos(10_000_000_000),
      changeAddress: consumer.address,
    });

    const result = await client.rateProvider({
      providerAddress: prov.address,
      providerPubkey: prov.pubkey,
      sessionId: 12345,
      skillCode: 0x0403,
      paymentTxId: randomBytes(32).toString('hex'),
      rating: 5,
    });

    assert.ok(result.txId);
    assert.equal(provider.broadcastLog.length, 1);
    client.destroy();
  });

  it('pay broadcasts a payment tx', async () => {
    const prov = makeAgent();
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => makeUtxos(10_000_000_000),
      changeAddress: consumer.address,
    });

    const result = await client.pay({
      providerAddress: prov.address,
      providerPubkey: prov.pubkey,
      amountKoinu: 500_000_000,
      method: 'htlc',
      sessionId: 12345,
      skillCode: 0x0403,
    });

    assert.ok(result.txId);
    assert.equal(provider.broadcastLog.length, 1);
    client.destroy();
  });

  it('pay rejects channel method (not yet implemented)', async () => {
    const prov = makeAgent();
    const client = new QPClient({
      address: consumer.address,
      pubkey: consumer.pubkey,
      privkey: Buffer.from(consumer.privkey),
      provider: provider as any,
      getUtxos: async () => makeUtxos(10_000_000_000),
      changeAddress: consumer.address,
    });

    await assert.rejects(
      () => client.pay({
        providerAddress: prov.address,
        providerPubkey: prov.pubkey,
        amountKoinu: 500_000_000,
        method: 'channel',
        sessionId: 12345,
        skillCode: 0x0403,
      }),
      /Channel payments not yet implemented/,
    );
    client.destroy();
  });
});

// ---------------------------------------------------------------------------
// QPProvider Tests
// ---------------------------------------------------------------------------

describe('QPProvider', () => {
  let provAgent: ReturnType<typeof makeAgent>;
  let prov: ReturnType<typeof mockProvider>;

  beforeEach(() => {
    provAgent = makeAgent();
    prov = mockProvider();
  });

  it('constructs with skills', () => {
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: provAgent.privkey,
      provider: prov as any,
      getUtxos: async () => makeUtxos(10_000_000_000),
      changeAddress: provAgent.address,
      skills: [{
        skillCode: 0x0403,
        priceKoinu: 500_000_000,
        priceUnit: PriceUnit.PER_REQUEST,
        description: 'OCR service',
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
        handler: async (req) => ({ result: 'ocr text' }),
      }],
    });

    assert.ok(provider);
    provider.destroy();
  });

  it('destroy zeroes private key', () => {
    const privCopy = Buffer.from(provAgent.privkey);
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: privCopy,
      provider: prov as any,
      getUtxos: async () => [],
      changeAddress: provAgent.address,
      skills: [],
    });

    assert.ok(privCopy.some(b => b !== 0));
    provider.destroy();
    assert.ok(privCopy.every(b => b === 0));
  });

  it('advertise broadcasts one tx per skill', async () => {
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: Buffer.from(provAgent.privkey),
      provider: prov as any,
      getUtxos: async () => makeUtxos(50_000_000_000),
      changeAddress: provAgent.address,
      skills: [
        {
          skillCode: 0x0403,
          priceKoinu: 500_000_000,
          priceUnit: PriceUnit.PER_REQUEST,
          description: 'OCR',
          flags: {
            supportsDirectHtlc: true, supportsSideloadHttps: true,
            supportsSideloadLibp2p: false, supportsSideloadIpfs: false,
            onlineNow: true, supportsPaymentChannel: false,
            acceptsPostPayment: false, isCompositeTool: false,
          },
          handler: async () => ({}),
        },
        {
          skillCode: 0x0201,
          priceKoinu: 100_000_000,
          priceUnit: PriceUnit.PER_REQUEST,
          description: 'Lint',
          flags: {
            supportsDirectHtlc: true, supportsSideloadHttps: true,
            supportsSideloadLibp2p: false, supportsSideloadIpfs: false,
            onlineNow: true, supportsPaymentChannel: false,
            acceptsPostPayment: false, isCompositeTool: false,
          },
          handler: async () => ({}),
        },
      ],
    });

    const txIds = await provider.advertise();
    assert.equal(txIds.length, 2);
    assert.equal(prov.broadcastLog.length, 2);
    assert.ok(txIds.every(id => id.length === 64));
    provider.destroy();
  });

  it('start/stop manages scan timer', () => {
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: Buffer.from(provAgent.privkey),
      provider: prov as any,
      getUtxos: async () => [],
      changeAddress: provAgent.address,
      skills: [],
      scanIntervalMs: 60_000,
    });

    provider.start();
    // Starting again is a no-op
    provider.start();

    provider.stop();
    // Stopping again is safe
    provider.stop();
    provider.destroy();
  });

  it('throws after destroy', async () => {
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: Buffer.from(provAgent.privkey),
      provider: prov as any,
      getUtxos: async () => [],
      changeAddress: provAgent.address,
      skills: [],
    });
    provider.destroy();

    await assert.rejects(
      () => provider.advertise(),
      /destroyed/,
    );
  });

  it('sessionCount starts at zero', () => {
    const provider = new QPProvider({
      address: provAgent.address,
      pubkey: provAgent.pubkey,
      privkey: Buffer.from(provAgent.privkey),
      provider: prov as any,
      getUtxos: async () => [],
      changeAddress: provAgent.address,
      skills: [],
    });

    assert.equal(provider.sessionCount, 0);
    provider.destroy();
  });
});

// ---------------------------------------------------------------------------
// CallState enum
// ---------------------------------------------------------------------------

describe('CallState', () => {
  it('has all expected states', () => {
    assert.equal(CallState.DISCOVERING, 'discovering');
    assert.equal(CallState.HANDSHAKING, 'handshaking');
    assert.equal(CallState.CONNECTING, 'connecting');
    assert.equal(CallState.REQUESTING, 'requesting');
    assert.equal(CallState.AWAITING_DELIVERY, 'awaiting_delivery');
    assert.equal(CallState.PAYING, 'paying');
    assert.equal(CallState.RATING, 'rating');
    assert.equal(CallState.COMPLETE, 'complete');
    assert.equal(CallState.FAILED, 'failed');
  });
});
