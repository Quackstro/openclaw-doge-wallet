/**
 * Sideload P2P unit tests — envelope, encryption, session manager.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "crypto";

import {
  deriveIV,
  createMessage,
  serializeMessage,
  deserializeMessage,
  encryptMessage,
  decryptMessage,
  envelopeToWire,
  wireToEnvelope,
  createSession,
} from "../dist/src/qp/sideload/envelope.js";

import {
  SessionManager,
  reassembleChunks,
} from "../dist/src/qp/sideload/session-manager.js";

import { SideloadProtocol } from "../dist/src/qp/sideload/types.js";
import type { SideloadConnectionInfo, SideloadSession } from "../dist/src/qp/sideload/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRemoteInfo(): SideloadConnectionInfo {
  return {
    sessionId: 42,
    port: 8443,
    ipv4: Buffer.from([1, 2, 3, 4]),
    protocol: SideloadProtocol.HTTPS,
    token: randomBytes(8),
  };
}

function makeSessionPair() {
  const sessionKey = randomBytes(32);
  const remoteInfo = makeRemoteInfo();

  const initiator = createSession({
    sessionId: 42,
    sessionKey,
    role: "initiator",
    remoteInfo,
  });
  const responder = createSession({
    sessionId: 42,
    sessionKey,
    role: "responder",
    remoteInfo,
  });

  return { initiator, responder, sessionKey };
}

// =========================================================================
// 1. IV Derivation
// =========================================================================

describe("IV Derivation", () => {
  it("produces 12-byte IV", () => {
    const key = randomBytes(32);
    const iv = deriveIV(key, 0n);
    assert.equal(iv.length, 12);
  });

  it("different counters produce different IVs", () => {
    const key = randomBytes(32);
    const iv0 = deriveIV(key, 0n);
    const iv1 = deriveIV(key, 1n);
    const iv2 = deriveIV(key, 2n);
    assert.ok(!iv0.equals(iv1));
    assert.ok(!iv1.equals(iv2));
  });

  it("same key+counter produces same IV", () => {
    const key = randomBytes(32);
    const iv1 = deriveIV(key, 42n);
    const iv2 = deriveIV(key, 42n);
    assert.ok(iv1.equals(iv2));
  });

  it("different keys produce different IVs", () => {
    const key1 = randomBytes(32);
    const key2 = randomBytes(32);
    const iv1 = deriveIV(key1, 0n);
    const iv2 = deriveIV(key2, 0n);
    assert.ok(!iv1.equals(iv2));
  });
});

// =========================================================================
// 2. Message Serialization
// =========================================================================

describe("Message Serialization", () => {
  it("createMessage sets default fields", () => {
    const msg = createMessage({ type: "request", body: { action: "test" } });
    assert.equal(msg.v, 1);
    assert.equal(msg.t, "request");
    assert.ok(msg.id.length > 0);
    assert.ok(msg.ts > 0);
  });

  it("serialize/deserialize round-trips JSON body", () => {
    const msg = createMessage({ type: "request", body: { foo: "bar", num: 42 } });
    const buf = serializeMessage(msg);
    const restored = deserializeMessage(buf);
    assert.equal(restored.t, "request");
    assert.deepEqual(restored.body, { foo: "bar", num: 42 });
    assert.equal(restored.id, msg.id);
  });

  it("serialize/deserialize round-trips Buffer body", () => {
    const data = Buffer.from("hello world");
    const msg = createMessage({ type: "chunk", body: data, seq: 0 });
    const buf = serializeMessage(msg);
    const restored = deserializeMessage(buf);
    assert.equal(restored.t, "chunk");
    assert.ok(Buffer.isBuffer(restored.body));
    assert.ok((restored.body as Buffer).equals(data));
    assert.equal(restored.seq, 0);
  });

  it("preserves metadata", () => {
    const msg = createMessage({
      type: "done",
      body: {},
      meta: { totalChunks: 10, totalSize: 1048576, sha256: "abc123" },
    });
    const buf = serializeMessage(msg);
    const restored = deserializeMessage(buf);
    assert.equal(restored.meta?.totalChunks, 10);
    assert.equal(restored.meta?.totalSize, 1048576);
    assert.equal(restored.meta?.sha256, "abc123");
  });
});

// =========================================================================
// 3. Encryption / Decryption
// =========================================================================

describe("Encryption", () => {
  it("encrypt then decrypt round-trips", () => {
    const { initiator, responder } = makeSessionPair();

    const msg = createMessage({ type: "request", body: { action: "ocr" } });
    const { envelope, nextCounter } = encryptMessage(initiator, msg);

    assert.equal(nextCounter, 2n); // initiator starts at 0, increments by 2

    const { message, nextCounter: recvNext } = decryptMessage(responder, envelope);
    assert.equal(message.t, "request");
    assert.deepEqual(message.body, { action: "ocr" });
    assert.equal(recvNext, 2n); // responder expected 0, increments by 2
  });

  it("bidirectional exchange", () => {
    const { initiator, responder } = makeSessionPair();

    // Initiator sends (counter 0)
    const req = createMessage({ type: "request", body: { q: "hello" } });
    const { envelope: e1 } = encryptMessage(initiator, req);
    initiator.sendCounter = 2n;

    const { message: m1 } = decryptMessage(responder, e1);
    responder.recvCounter = 2n;
    assert.deepEqual(m1.body, { q: "hello" });

    // Responder sends (counter 1)
    const res = createMessage({ type: "response", body: { a: "world" }, ref: m1.id });
    const { envelope: e2 } = encryptMessage(responder, res);
    responder.sendCounter = 3n;

    const { message: m2 } = decryptMessage(initiator, e2);
    initiator.recvCounter = 3n;
    assert.deepEqual(m2.body, { a: "world" });
    assert.equal(m2.ref, m1.id);
  });

  it("rejects tampered ciphertext", () => {
    const { initiator, responder } = makeSessionPair();

    const msg = createMessage({ type: "request", body: { secret: "data" } });
    const { envelope } = encryptMessage(initiator, msg);

    // Tamper with ciphertext
    envelope.ciphertext[0] ^= 0xff;

    assert.throws(() => decryptMessage(responder, envelope));
  });

  it("rejects wrong session key", () => {
    const { initiator } = makeSessionPair();
    const wrongKey = randomBytes(32);
    const wrongSession = createSession({
      sessionId: 42,
      sessionKey: wrongKey,
      role: "responder",
      remoteInfo: makeRemoteInfo(),
    });

    const msg = createMessage({ type: "request", body: {} });
    const { envelope } = encryptMessage(initiator, msg);

    assert.throws(() => decryptMessage(wrongSession, envelope));
  });

  it("rejects replay (out-of-order counter)", () => {
    const { initiator, responder } = makeSessionPair();

    const msg1 = createMessage({ type: "request", body: { n: 1 } });
    const { envelope: e1 } = encryptMessage(initiator, msg1);
    initiator.sendCounter = 2n;

    // Decrypt first message
    decryptMessage(responder, e1);
    responder.recvCounter = 2n;

    // Try to replay same message — counter mismatch
    assert.throws(
      () => decryptMessage(responder, e1),
      /IV mismatch/
    );
  });
});

// =========================================================================
// 4. Wire format
// =========================================================================

describe("Wire Format", () => {
  it("envelopeToWire/wireToEnvelope round-trips", () => {
    const envelope = {
      iv: randomBytes(12),
      ciphertext: randomBytes(100),
      tag: randomBytes(16),
    };
    const wire = envelopeToWire(envelope);
    assert.equal(wire.length, 12 + 100 + 16);

    const restored = wireToEnvelope(wire);
    assert.ok(restored.iv.equals(envelope.iv));
    assert.ok(restored.ciphertext.equals(envelope.ciphertext));
    assert.ok(restored.tag.equals(envelope.tag));
  });

  it("rejects too-short wire data", () => {
    assert.throws(() => wireToEnvelope(Buffer.alloc(10)), /too short/);
  });

  it("handles empty ciphertext", () => {
    const wire = Buffer.concat([randomBytes(12), randomBytes(16)]);
    const envelope = wireToEnvelope(wire);
    assert.equal(envelope.ciphertext.length, 0);
  });
});

// =========================================================================
// 5. Session creation
// =========================================================================

describe("Session", () => {
  it("createSession sets correct counters for initiator", () => {
    const session = createSession({
      sessionId: 1,
      sessionKey: randomBytes(32),
      role: "initiator",
      remoteInfo: makeRemoteInfo(),
    });
    assert.equal(session.sendCounter, 0n);
    assert.equal(session.recvCounter, 1n);
    assert.equal(session.role, "initiator");
  });

  it("createSession sets correct counters for responder", () => {
    const session = createSession({
      sessionId: 1,
      sessionKey: randomBytes(32),
      role: "responder",
      remoteInfo: makeRemoteInfo(),
    });
    assert.equal(session.sendCounter, 1n);
    assert.equal(session.recvCounter, 0n);
    assert.equal(session.role, "responder");
  });

  it("rejects non-32-byte session key", () => {
    assert.throws(
      () => createSession({
        sessionId: 1,
        sessionKey: randomBytes(16),
        role: "initiator",
        remoteInfo: makeRemoteInfo(),
      }),
      /32 bytes/
    );
  });
});

// =========================================================================
// 6. SessionManager
// =========================================================================

describe("SessionManager", () => {
  it("buildRequest + processIncoming round-trips", () => {
    const sessionKey = randomBytes(32);
    const remoteInfo = makeRemoteInfo();

    const sender = new SessionManager({
      sessionId: 1,
      sessionKey,
      role: "initiator",
      remoteInfo,
    });
    const receiver = new SessionManager({
      sessionId: 1,
      sessionKey,
      role: "responder",
      remoteInfo,
    });

    const { wire, messageId } = sender.buildRequest({ action: "test" });
    const msg = receiver.processIncoming(wire);
    assert.equal(msg.t, "request");
    assert.deepEqual(msg.body, { action: "test" });
    assert.equal(msg.id, messageId);
  });

  it("response resolves pending request", async () => {
    const sessionKey = randomBytes(32);
    const remoteInfo = makeRemoteInfo();

    const client = new SessionManager({
      sessionId: 1,
      sessionKey,
      role: "initiator",
      remoteInfo,
    });
    const server = new SessionManager({
      sessionId: 1,
      sessionKey,
      role: "responder",
      remoteInfo,
    });

    // Client sends request
    const { wire: reqWire, messageId } = client.buildRequest({ q: "ping" });
    const responsePromise = client.expectResponse(messageId, 5000);

    // Server receives and responds
    const reqMsg = server.processIncoming(reqWire);
    const resWire = server.buildResponse(reqMsg.id, { a: "pong" });

    // Client receives response
    client.processIncoming(resWire);

    const response = await responsePromise;
    assert.deepEqual(response.body, { a: "pong" });
    assert.equal(response.ref, messageId);

    client.destroy();
    server.destroy();
  });

  it("error response rejects pending request", async () => {
    const sessionKey = randomBytes(32);
    const remoteInfo = makeRemoteInfo();

    const client = new SessionManager({
      sessionId: 1, sessionKey, role: "initiator", remoteInfo,
    });
    const server = new SessionManager({
      sessionId: 1, sessionKey, role: "responder", remoteInfo,
    });

    const { wire: reqWire, messageId } = client.buildRequest({ q: "fail" });
    const responsePromise = client.expectResponse(messageId, 5000);

    const reqMsg = server.processIncoming(reqWire);
    const errWire = server.buildError(reqMsg.id, { code: 500, message: "Internal error" });
    client.processIncoming(errWire);

    await assert.rejects(responsePromise, /Remote error/);

    client.destroy();
    server.destroy();
  });

  it("destroy cleans up pending requests", async () => {
    const client = new SessionManager({
      sessionId: 1,
      sessionKey: randomBytes(32),
      role: "initiator",
      remoteInfo: makeRemoteInfo(),
    });

    const { messageId } = client.buildRequest({ q: "test" });
    const promise = client.expectResponse(messageId, 60_000);
    assert.equal(client.pendingCount, 1);

    client.destroy();
    assert.equal(client.pendingCount, 0);

    await assert.rejects(promise, /Session destroyed/);
  });
});

// =========================================================================
// 7. Chunked transfer
// =========================================================================

describe("Chunked Transfer", () => {
  it("buildChunks + reassembleChunks round-trips", () => {
    const sessionKey = randomBytes(32);
    const remoteInfo = makeRemoteInfo();

    const sender = new SessionManager({
      sessionId: 1, sessionKey, role: "initiator", remoteInfo,
    });
    const receiver = new SessionManager({
      sessionId: 1, sessionKey, role: "responder", remoteInfo,
    });

    // 3 MB payload, 1 MB chunks → 3 chunks + 1 done
    const payload = randomBytes(3 * 1024 * 1024);
    const wires = sender.buildChunks(payload, 1_048_576);
    assert.equal(wires.length, 4); // 3 chunks + 1 done

    const chunks: Array<{ seq: number; body: Buffer }> = [];
    let expectedHash: string | undefined;

    for (const wire of wires) {
      const msg = receiver.processIncoming(wire);
      if (msg.t === "chunk") {
        chunks.push({ seq: msg.seq!, body: msg.body as Buffer });
      } else if (msg.t === "done") {
        expectedHash = msg.meta?.sha256;
      }
    }

    assert.equal(chunks.length, 3);
    assert.ok(expectedHash);

    const assembled = reassembleChunks(chunks, expectedHash);
    assert.ok(assembled.equals(payload));

    sender.destroy();
    receiver.destroy();
  });

  it("reassembleChunks detects missing chunk", () => {
    const chunks = [
      { seq: 0, body: Buffer.from("a") },
      { seq: 2, body: Buffer.from("c") }, // seq 1 missing
    ];
    assert.throws(() => reassembleChunks(chunks), /Missing chunk/);
  });

  it("reassembleChunks detects hash mismatch", () => {
    const chunks = [
      { seq: 0, body: Buffer.from("hello") },
    ];
    assert.throws(
      () => reassembleChunks(chunks, "0000000000000000000000000000000000000000000000000000000000000000"),
      /Hash mismatch/
    );
  });

  it("reassembleChunks works with correct hash", () => {
    const data = Buffer.from("test data");
    const hash = createHash("sha256").update(data).digest("hex");
    const assembled = reassembleChunks([{ seq: 0, body: data }], hash);
    assert.ok(assembled.equals(data));
  });
});
