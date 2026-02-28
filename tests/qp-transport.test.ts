/**
 * HTTPS Sideload Transport Tests
 *
 * Tests the HttpsTransport implementation:
 * - Server start/stop lifecycle
 * - Session registration + bearer token auth
 * - send/receive round-trip (loopback)
 * - Timeout behavior
 * - Multiple concurrent sessions
 * - Auth rejection
 * - Payload size limits
 * - Integration with SessionManager (encrypted round-trip)
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HttpsTransport } from '../dist/src/qp/sideload/transport.js';
import { SessionManager } from '../dist/src/qp/sideload/session-manager.js';
import { createSession } from '../dist/src/qp/sideload/envelope.js';
import { SideloadProtocol, type SideloadConnectionInfo } from '../dist/src/qp/sideload/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnectionInfo(
  sessionId: number,
  port: number,
  token: Buffer,
  protocol: number = 99, // Default to non-HTTPS for plaintext test transports
): SideloadConnectionInfo {
  return {
    sessionId,
    port,
    ipv4: Buffer.from([127, 0, 0, 1]),
    protocol,
    token,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HttpsTransport', () => {
  const transports: HttpsTransport[] = [];

  afterEach(async () => {
    for (const t of transports) {
      await t.destroy();
    }
    transports.length = 0;
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  it('starts server on random port', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    assert.ok(port > 0, `Port should be positive: ${port}`);
    assert.ok(transport.listening, 'Server should be listening');
    assert.equal(transport.port, port);
  });

  it('startServer is idempotent', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port1 = await transport.startServer();
    const port2 = await transport.startServer();
    assert.equal(port1, port2);
  });

  it('destroy stops server and cleans sessions', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await transport.startServer();
    transport.registerSession(1, randomBytes(8));
    assert.equal(transport.sessionCount, 1);

    await transport.destroy();
    assert.ok(!transport.listening);
    assert.equal(transport.sessionCount, 0);
  });

  it('throws after destroy', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await transport.destroy();
    await assert.rejects(
      () => transport.send(makeConnectionInfo(1, 9999, randomBytes(8)), Buffer.from('test')),
      /destroyed/
    );
    await assert.rejects(
      () => transport.receive(1, 100),
      /destroyed/
    );
  });

  // =========================================================================
  // Send / Receive
  // =========================================================================

  it('send and receive round-trip (loopback)', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    const sessionId = 42;
    const token = randomBytes(8);
    transport.registerSession(sessionId, token);

    const wire = randomBytes(256);
    const remoteInfo = makeConnectionInfo(sessionId, port, token);

    // Send to self (loopback)
    await transport.send(remoteInfo, wire);

    // Receive
    const received = await transport.receive(sessionId, 5000);
    assert.deepEqual(received, wire);
  });

  it('receive resolves waiting promise when send arrives', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    const sessionId = 100;
    const token = randomBytes(8);
    transport.registerSession(sessionId, token);

    const wire = randomBytes(128);
    const remoteInfo = makeConnectionInfo(sessionId, port, token);

    // Start receive first (will wait)
    const receivePromise = transport.receive(sessionId, 5000);

    // Small delay then send
    await new Promise(r => setTimeout(r, 50));
    await transport.send(remoteInfo, wire);

    const received = await receivePromise;
    assert.deepEqual(received, wire);
  });

  it('receive times out', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await transport.startServer();
    transport.registerSession(1, randomBytes(8));

    await assert.rejects(
      () => transport.receive(1, 100),
      /timeout/i
    );
  });

  it('receive rejects for unregistered session', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await assert.rejects(
      () => transport.receive(999, 100),
      /No registered session/
    );
  });

  // =========================================================================
  // Multiple sessions
  // =========================================================================

  it('handles multiple concurrent sessions independently', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    const token1 = randomBytes(8);
    const token2 = randomBytes(8);
    transport.registerSession(1, token1);
    transport.registerSession(2, token2);

    const wire1 = Buffer.from('session-1-data');
    const wire2 = Buffer.from('session-2-data');

    await transport.send(makeConnectionInfo(1, port, token1), wire1);
    await transport.send(makeConnectionInfo(2, port, token2), wire2);

    const recv1 = await transport.receive(1, 1000);
    const recv2 = await transport.receive(2, 1000);

    assert.deepEqual(recv1, wire1);
    assert.deepEqual(recv2, wire2);
  });

  it('messages queue in order', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    const token = randomBytes(8);
    transport.registerSession(1, token);
    const info = makeConnectionInfo(1, port, token);

    // Send 3 messages
    await transport.send(info, Buffer.from('first'));
    await transport.send(info, Buffer.from('second'));
    await transport.send(info, Buffer.from('third'));

    // Receive in order
    assert.deepEqual(await transport.receive(1, 1000), Buffer.from('first'));
    assert.deepEqual(await transport.receive(1, 1000), Buffer.from('second'));
    assert.deepEqual(await transport.receive(1, 1000), Buffer.from('third'));
  });

  // =========================================================================
  // Auth
  // =========================================================================

  it('rejects request with wrong token', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();
    transport.registerSession(1, randomBytes(8));

    const wrongToken = randomBytes(8);
    const info = makeConnectionInfo(1, port, wrongToken);

    await assert.rejects(
      () => transport.send(info, Buffer.from('bad')),
      /401/
    );
  });

  it('rejects request to unknown session', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const port = await transport.startServer();

    const info = makeConnectionInfo(999, port, randomBytes(8));
    await assert.rejects(
      () => transport.send(info, Buffer.from('nope')),
      /404/
    );
  });

  // =========================================================================
  // Close session
  // =========================================================================

  it('close rejects pending waiters', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await transport.startServer();
    transport.registerSession(1, randomBytes(8));

    const receivePromise = transport.receive(1, 30_000);
    await transport.close(1);

    await assert.rejects(receivePromise, /closed/i);
  });

  // =========================================================================
  // Payload limits
  // =========================================================================

  it('rejects oversized payloads', async () => {
    const transport = new HttpsTransport({ maxMessageSize: 100 });
    transports.push(transport);

    const port = await transport.startServer();
    const token = randomBytes(8);
    transport.registerSession(1, token);

    const oversized = randomBytes(200);
    await assert.rejects(
      () => transport.send(makeConnectionInfo(1, port, token), oversized),
      /413/
    );
  });

  // =========================================================================
  // Bidirectional (consumer ↔ provider)
  // =========================================================================

  it('bidirectional communication between two transports', async () => {
    const consumer = new HttpsTransport();
    const provider = new HttpsTransport();
    transports.push(consumer, provider);

    const consumerPort = await consumer.startServer();
    const providerPort = await provider.startServer();

    const sessionId = 12345;
    const consumerToken = randomBytes(8);
    const providerToken = randomBytes(8);

    consumer.registerSession(sessionId, providerToken); // consumer accepts from provider
    provider.registerSession(sessionId, consumerToken); // provider accepts from consumer

    const consumerInfo = makeConnectionInfo(sessionId, consumerPort, providerToken);
    const providerInfo = makeConnectionInfo(sessionId, providerPort, consumerToken);

    // Consumer → Provider
    await consumer.send(providerInfo, Buffer.from('request'));
    const req = await provider.receive(sessionId, 1000);
    assert.deepEqual(req, Buffer.from('request'));

    // Provider → Consumer
    await provider.send(consumerInfo, Buffer.from('response'));
    const res = await consumer.receive(sessionId, 1000);
    assert.deepEqual(res, Buffer.from('response'));
  });

  // =========================================================================
  // Encrypted round-trip with SessionManager
  // =========================================================================

  it('encrypted sideload message round-trip via transport', async () => {
    const consumerTransport = new HttpsTransport();
    const providerTransport = new HttpsTransport();
    transports.push(consumerTransport, providerTransport);

    const consumerPort = await consumerTransport.startServer();
    const providerPort = await providerTransport.startServer();

    const sessionId = 777;
    const sessionKey = randomBytes(32);
    const consumerToken = randomBytes(8);
    const providerToken = randomBytes(8);

    // Create session managers with shared key
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

    const consumerMgr = new SessionManager(consumerSession);
    const providerMgr = new SessionManager(providerSession);

    // Register sessions on both transports
    consumerTransport.registerSession(sessionId, providerToken);
    providerTransport.registerSession(sessionId, consumerToken);

    const consumerInfo = makeConnectionInfo(sessionId, consumerPort, providerToken);
    const providerInfo = makeConnectionInfo(sessionId, providerPort, consumerToken);

    // Consumer sends encrypted request
    const { wire: reqWire, messageId } = consumerMgr.buildRequest({ action: 'echo', data: 'hello' });
    await consumerTransport.send(providerInfo, reqWire);

    // Provider receives + decrypts
    const receivedWire = await providerTransport.receive(sessionId, 5000);
    const decrypted = providerMgr.processIncoming(receivedWire);
    assert.equal(decrypted.t, 'request');
    const body = decrypted.body as Record<string, unknown>;
    assert.equal(body.action, 'echo');
    assert.equal(body.data, 'hello');

    // Provider sends encrypted response
    const respWire = providerMgr.buildResponse(decrypted.id, { result: 'world' });
    await providerTransport.send(consumerInfo, respWire);

    // Consumer receives + decrypts
    const respReceived = await consumerTransport.receive(sessionId, 5000);
    const respDecrypted = consumerMgr.processIncoming(respReceived);
    assert.equal(respDecrypted.t, 'response');
    const respBody = respDecrypted.body as Record<string, unknown>;
    assert.equal(respBody.result, 'world');
    assert.equal(respDecrypted.ref, decrypted.id);
  });

  // =========================================================================
  // Edge cases (CodeRabbit review)
  // =========================================================================

  it('registerSession throws on duplicate sessionId', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const token = randomBytes(8);
    transport.registerSession(1, token);
    assert.throws(
      () => transport.registerSession(1, randomBytes(8)),
      /already registered/
    );
  });

  it('startServer rejects after destroy', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    await transport.destroy();
    await assert.rejects(
      () => transport.startServer(),
      /destroyed/
    );
  });

  it('concurrent startServer calls return same port', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);

    const [p1, p2, p3] = await Promise.all([
      transport.startServer(),
      transport.startServer(),
      transport.startServer(),
    ]);
    assert.equal(p1, p2);
    assert.equal(p2, p3);
  });

  it('queue bounded — returns 503 when full', async () => {
    const transport = new HttpsTransport({ maxQueueSize: 2 });
    transports.push(transport);

    const port = await transport.startServer();
    const token = randomBytes(8);
    transport.registerSession(1, token);
    const info = makeConnectionInfo(1, port, token);

    // Fill the queue
    await transport.send(info, Buffer.from('msg1'));
    await transport.send(info, Buffer.from('msg2'));

    // Third should fail (503)
    await assert.rejects(
      () => transport.send(info, Buffer.from('msg3')),
      /503/
    );

    // Drain and verify order
    assert.deepEqual(await transport.receive(1, 1000), Buffer.from('msg1'));
    assert.deepEqual(await transport.receive(1, 1000), Buffer.from('msg2'));
  });

  it('registerSession rejects after destroy', async () => {
    const transport = new HttpsTransport();
    transports.push(transport);
    await transport.destroy();
    assert.throws(
      () => transport.registerSession(1, randomBytes(8)),
      /destroyed/
    );
  });

  // =========================================================================
  // TLS
  // =========================================================================

  it('TLS round-trip with self-signed cert', async () => {
    // Load pre-generated test certificates (10-year validity)
    const fixturesDir = join(import.meta.dirname, 'fixtures');
    const keyPem = readFileSync(join(fixturesDir, 'test-key.pem'), 'utf8');
    const certPem = readFileSync(join(fixturesDir, 'test-cert.pem'), 'utf8');

    const transport = new HttpsTransport({
      tls: { key: keyPem, cert: certPem },
    });
    transports.push(transport);

    const port = await transport.startServer();
    assert.ok(port > 0);
    assert.ok(transport.listening);

    const sessionId = 99;
    const token = randomBytes(8);
    transport.registerSession(sessionId, token);

    const wire = randomBytes(64);
    const info = makeConnectionInfo(sessionId, port, token, SideloadProtocol.HTTPS);

    // Override NODE_TLS_REJECT_UNAUTHORIZED for self-signed cert in test
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      await transport.send(info, wire);
      const received = await transport.receive(sessionId, 5000);
      assert.deepEqual(received, wire);
    } finally {
      if (prev === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
      }
    }
  });
});
