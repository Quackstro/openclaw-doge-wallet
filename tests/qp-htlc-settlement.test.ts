/**
 * HTLC Settlement Tests
 *
 * Tests the atomic HTLC settlement flow between consumer and provider
 * using the HttpsTransport for P2P communication.
 *
 * Full lifecycle: offer → fund → deliver → claim → verify
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import { ConsumerSettlement, ProviderSettlement } from '../dist/src/qp/orchestrator/htlc-settlement.js';
import { HttpsTransport } from '../dist/src/qp/sideload/transport.js';
import { SessionManager } from '../dist/src/qp/sideload/session-manager.js';
import { createSession } from '../dist/src/qp/sideload/envelope.js';
import type { SideloadConnectionInfo } from '../dist/src/qp/sideload/types.js';


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const _require = createRequire(import.meta.url);
const bc = _require('bitcore-lib-doge');

function makeKeyPair() {
  // Use bitcore for real secp256k1 keypairs (required for HTLC scripts)
  const pk = new bc.PrivateKey();
  return {
    pub: Buffer.from(pk.publicKey.toBuffer()),
    priv: Buffer.from(pk.toBuffer()),
    addr: pk.toAddress().toString(),
  };
}

function makeConnectionInfo(sessionId: number, port: number, token: Buffer): SideloadConnectionInfo {
  return {
    sessionId,
    port,
    ipv4: Buffer.from([127, 0, 0, 1]),
    protocol: 99, // plaintext HTTP for tests
    token,
  };
}

// Mock broadcast that returns a fake txid
function makeMockProvider() {
  const txids: string[] = [];
  return {
    broadcastTransaction: async (txHex: string) => {
      const txid = randomBytes(32).toString('hex');
      txids.push(txid);
      return { txid };
    },
    txids,
  };
}

// Create paired session managers
function createPairedSessions(
  sessionId: number,
  consumerPort: number,
  providerPort: number,
  consumerToken: Buffer,
  providerToken: Buffer,
) {
  const sessionKey = randomBytes(32);

  const consumerSession = createSession({
    sessionId,
    sessionKey,
    role: 'initiator',
    remoteInfo: makeConnectionInfo(sessionId, providerPort, consumerToken),
  });

  const providerSession = createSession({
    sessionId,
    sessionKey,
    role: 'responder',
    remoteInfo: makeConnectionInfo(sessionId, consumerPort, providerToken),
  });

  return {
    consumerMgr: new SessionManager(consumerSession),
    providerMgr: new SessionManager(providerSession),
    sessionKey,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HTLC Settlement', () => {
  const transports: HttpsTransport[] = [];
  const settlements: Array<{ destroy: () => void }> = [];

  afterEach(async () => {
    for (const s of settlements) s.destroy();
    settlements.length = 0;
    for (const t of transports) await t.destroy();
    transports.length = 0;
  });

  it('ConsumerSettlement + ProviderSettlement: full offer → fund → claim lifecycle', async () => {
    // Setup transports
    const consumerTransport = new HttpsTransport();
    const providerTransport = new HttpsTransport();
    transports.push(consumerTransport, providerTransport);

    const consumerPort = await consumerTransport.startServer();
    const providerPort = await providerTransport.startServer();

    const sessionId = 42;
    const consumerToken = randomBytes(8);
    const providerToken = randomBytes(8);

    consumerTransport.registerSession(sessionId, providerToken);
    providerTransport.registerSession(sessionId, consumerToken);

    const consumer = makeKeyPair();
    const provider = makeKeyPair();
    const consumerMockProvider = makeMockProvider();
    const providerMockProvider = makeMockProvider();

    const { consumerMgr, providerMgr } = createPairedSessions(
      sessionId, consumerPort, providerPort, consumerToken, providerToken
    );

    const consumerInfo = makeConnectionInfo(sessionId, consumerPort, providerToken);
    const providerInfo = makeConnectionInfo(sessionId, providerPort, consumerToken);

    // Create settlements
    const consumerSettlement = new ConsumerSettlement({
      consumerPubkey: consumer.pub,
      consumerPrivkey: consumer.priv,
      consumerAddress: consumer.addr,
      getUtxos: async () => [{
        txId: 'a'.repeat(64),
        outputIndex: 0,
        satoshis: 500_000_000, // 5 DOGE
        script: '76a914' + 'b'.repeat(40) + '88ac',
      }],
      changeAddress: consumer.addr,
      provider: consumerMockProvider,
    });
    settlements.push(consumerSettlement);

    const providerSettlement = new ProviderSettlement({
      providerPubkey: provider.pub,
      providerPrivkey: provider.priv,
      providerAddress: provider.addr,
      provider: providerMockProvider,
    });
    settlements.push(providerSettlement);

    const timeoutBlock = 1000;
    const skillCode = 0x0403;
    const amountKoinu = 100_000_000; // 1 DOGE

    // Run provider and consumer in parallel

    // Provider: create offer and send, then wait for funding and claim
    const providerFlow = (async () => {
      const offer = await providerSettlement.createAndSendOffer({
        sessionManager: providerMgr,
        transport: providerTransport,
        remoteInfo: consumerInfo,
        consumerPubkey: consumer.pub,
        timeoutBlock,
        sessionId,
        skillCode,
      });

      assert.ok(offer.htlcId, 'Provider should have htlcId');
      assert.ok(offer.secret.length > 0, 'Provider should have secret');
      assert.ok(offer.secretHash.length > 0, 'Provider should have secretHash');

      // Wait for funding and claim
      const claim = await providerSettlement.waitForFundingAndClaim({
        sessionManager: providerMgr,
        transport: providerTransport,
        remoteInfo: consumerInfo,
        htlcId: offer.htlcId,
        offerMessageId: offer.offerMessageId,
        timeoutMs: 10_000,
      });

      assert.ok(claim.claimTxId, 'Should have claim txId');
      assert.ok(claim.secret.length > 0, 'Should have revealed secret');
      return { offer, claim };
    })();

    // Consumer: wait for offer, accept, fund
    const consumerFlow = (async () => {
      const result = await consumerSettlement.settle({
        sessionManager: consumerMgr,
        transport: consumerTransport,
        remoteInfo: providerInfo,
        providerPubkey: provider.pub,
        amountKoinu,
        feeKoinu: 100_000,
        timeoutMs: 10_000,
      });

      assert.ok(result.htlcId, 'Consumer should have htlcId');
      assert.ok(result.fundingTxId, 'Consumer should have fundingTxId');
      return result;
    })();

    // Wait for both sides to complete
    const [providerResult, consumerResult] = await Promise.all([providerFlow, consumerFlow]);

    // Verify cross-references
    assert.ok(providerResult.claim.claimTxId);
    assert.ok(consumerResult.fundingTxId);

    // Provider broadcast at least a claim tx
    assert.ok(providerMockProvider.txids.length >= 1, 'Provider should have broadcast claim');

    // Consumer broadcast funding tx
    assert.ok(consumerMockProvider.txids.length >= 1, 'Consumer should have broadcast funding');
  });

  it('ProviderSettlement.createAndSendOffer sends htlc_offer via sideload', async () => {
    const consumerTransport = new HttpsTransport();
    const providerTransport = new HttpsTransport();
    transports.push(consumerTransport, providerTransport);

    const consumerPort = await consumerTransport.startServer();
    const providerPort = await providerTransport.startServer();

    const sessionId = 77;
    const consumerToken = randomBytes(8);
    const providerToken = randomBytes(8);

    consumerTransport.registerSession(sessionId, providerToken);
    providerTransport.registerSession(sessionId, consumerToken);

    const consumer = makeKeyPair();
    const provider = makeKeyPair();

    const { consumerMgr, providerMgr } = createPairedSessions(
      sessionId, consumerPort, providerPort, consumerToken, providerToken
    );

    const consumerInfo = makeConnectionInfo(sessionId, consumerPort, providerToken);
    const providerInfo = makeConnectionInfo(sessionId, providerPort, consumerToken);

    const providerSettlement = new ProviderSettlement({
      providerPubkey: provider.pub,
      providerPrivkey: provider.priv,
      providerAddress: provider.addr,
      provider: makeMockProvider(),
    });
    settlements.push(providerSettlement);

    // Provider sends offer
    const offerPromise = providerSettlement.createAndSendOffer({
      sessionManager: providerMgr,
      transport: providerTransport,
      remoteInfo: consumerInfo,
      consumerPubkey: consumer.pub,
      timeoutBlock: 500,
      sessionId,
      skillCode: 0x0101,
    });

    // Consumer receives and decrypts
    const wire = await consumerTransport.receive(sessionId, 5000);
    const msg = consumerMgr.processIncoming(wire);

    const offer = await offerPromise;

    const body = msg.body as Record<string, unknown>;
    assert.equal(body.type, 'htlc_offer');
    assert.equal(body.secretHash, offer.secretHash.toString('hex'));
    assert.equal(body.timeoutBlock, 500);
    assert.equal(body.skillCode, 0x0101);
  });

  it('ConsumerSettlement rejects non-offer message', async () => {
    const consumerTransport = new HttpsTransport();
    const providerTransport = new HttpsTransport();
    transports.push(consumerTransport, providerTransport);

    const consumerPort = await consumerTransport.startServer();
    const providerPort = await providerTransport.startServer();

    const sessionId = 88;
    const consumerToken = randomBytes(8);
    const providerToken = randomBytes(8);

    consumerTransport.registerSession(sessionId, providerToken);
    providerTransport.registerSession(sessionId, consumerToken);

    const consumer = makeKeyPair();
    const provider = makeKeyPair();

    const { consumerMgr, providerMgr } = createPairedSessions(
      sessionId, consumerPort, providerPort, consumerToken, providerToken
    );

    const consumerInfo = makeConnectionInfo(sessionId, consumerPort, providerToken);
    const providerInfo = makeConnectionInfo(sessionId, providerPort, consumerToken);

    const consumerSettlement = new ConsumerSettlement({
      consumerPubkey: consumer.pub,
      consumerPrivkey: consumer.priv,
      consumerAddress: consumer.addr,
      getUtxos: async () => [],
      changeAddress: consumer.addr,
      provider: makeMockProvider(),
    });
    settlements.push(consumerSettlement);

    // Provider sends a non-offer message
    const badWire = providerMgr.buildResponse('fake-ref', { type: 'not_an_offer' });
    await providerTransport.send(consumerInfo, badWire);

    // Consumer should reject
    // Note: processIncoming on a response without a pending ref will still decode it,
    // but settle() checks the type field
    await assert.rejects(
      () => consumerSettlement.settle({
        sessionManager: consumerMgr,
        transport: consumerTransport,
        remoteInfo: providerInfo,
        providerPubkey: provider.pub,
        amountKoinu: 100_000_000,
        feeKoinu: 100_000,
        timeoutMs: 2000,
      }),
      /Expected htlc_offer/
    );
  });

  it('settlement classes clean up on destroy', () => {
    const consumer = makeKeyPair();
    const provider = makeKeyPair();

    const cs = new ConsumerSettlement({
      consumerPubkey: consumer.pub,
      consumerPrivkey: consumer.priv,
      consumerAddress: consumer.addr,
      getUtxos: async () => [],
      changeAddress: consumer.addr,
      provider: makeMockProvider(),
    });

    const ps = new ProviderSettlement({
      providerPubkey: provider.pub,
      providerPrivkey: provider.priv,
      providerAddress: provider.addr,
      provider: makeMockProvider(),
    });

    // Should not throw
    cs.destroy();
    ps.destroy();
  });
});
