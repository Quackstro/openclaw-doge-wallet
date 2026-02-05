/**
 * DOGE Wallet — P2P Transaction Broadcaster
 *
 * Broadcasts signed transactions directly to the Dogecoin P2P network.
 * No API keys, no rate limits, no third-party dependency.
 *
 * Flow per peer:
 *   1. TCP connect (5s timeout)
 *   2. Send version message
 *   3. Wait for version + verack (10s timeout)
 *   4. Send verack in response
 *   5. Send tx message
 *   6. Brief pause for propagation, then disconnect
 *
 * Much decentralized. Very P2P. Wow. 🐕
 */

import { Socket } from "node:net";
import { discoverPeers, type PeerInfo } from "./peers.js";
import {
  buildMessage,
  buildVersionPayload,
  buildVerackMessage,
  buildTxMessage,
  parseMessageHeader,
  HEADER_SIZE,
} from "./protocol.js";

// ============================================================================
// Types
// ============================================================================

export type LogFn = (level: "info" | "warn" | "error", msg: string) => void;

export interface P2PBroadcastResult {
  /** Whether at least one peer accepted the tx relay */
  success: boolean;
  /** Number of peers that completed the handshake + tx send */
  peersReached: number;
}

// ============================================================================
// Timeouts
// ============================================================================

/** TCP connection timeout (ms) */
const CONNECT_TIMEOUT_MS = 5_000;

/** Handshake (version/verack exchange) timeout (ms) */
const HANDSHAKE_TIMEOUT_MS = 10_000;

/** Minimum peers to consider broadcast reliable */
const MIN_PEERS_FOR_SUCCESS = 1;

/** Target number of peers to connect to */
const TARGET_PEERS = 3;

/** Max peers to attempt (cycle through if some fail) */
const MAX_PEER_ATTEMPTS = 8;

/** Brief delay after sending tx before disconnecting (ms) — lets the peer process it */
const POST_TX_DELAY_MS = 500;

// ============================================================================
// Public API
// ============================================================================

/**
 * Broadcast a signed transaction to the Dogecoin P2P network.
 *
 * Discovers peers via DNS seeds, connects to multiple nodes,
 * performs the version handshake, and relays the raw transaction.
 *
 * @param signedTxHex - Hex-encoded signed transaction
 * @param network - "mainnet" or "testnet"
 * @param log - Optional logger function
 * @returns P2PBroadcastResult
 */
export async function broadcastViaP2P(
  signedTxHex: string,
  network: "mainnet" | "testnet",
  log?: LogFn,
): Promise<P2PBroadcastResult> {
  const noop: LogFn = () => {};
  const _log = log ?? noop;

  _log("info", "doge-wallet: p2p: starting P2P broadcast...");

  // Discover peers
  const peers = await discoverPeers(network, MAX_PEER_ATTEMPTS, _log);
  if (peers.length === 0) {
    _log("error", "doge-wallet: p2p: no peers discovered — cannot broadcast via P2P");
    return { success: false, peersReached: 0 };
  }

  // Try peers concurrently (up to TARGET_PEERS at a time, then more if needed)
  let peersReached = 0;
  const peersToTry = peers.slice(0, MAX_PEER_ATTEMPTS);

  // Run first batch concurrently
  const results = await Promise.allSettled(
    peersToTry.map((peer) => relayToPeer(peer, signedTxHex, network, _log)),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      peersReached++;
    }
  }

  const success = peersReached >= MIN_PEERS_FOR_SUCCESS;
  _log(
    success ? "info" : "warn",
    `doge-wallet: p2p: broadcast complete — ${peersReached}/${peersToTry.length} peers reached` +
      (success ? " ✓" : " (below minimum threshold)"),
  );

  return { success, peersReached };
}

// ============================================================================
// Per-Peer Relay
// ============================================================================

/**
 * Connect to a single peer, perform handshake, and send the transaction.
 *
 * @returns true if the tx was sent successfully, false on any failure
 */
async function relayToPeer(
  peer: PeerInfo,
  signedTxHex: string,
  network: "mainnet" | "testnet",
  log: LogFn,
): Promise<boolean> {
  const tag = `${peer.ip}:${peer.port}`;

  return new Promise<boolean>((resolve) => {
    const socket = new Socket();
    let resolved = false;
    let handshakeComplete = false;
    let receivedVersion = false;
    let receivedVerack = false;
    let receiveBuffer = Buffer.alloc(0);

    const finish = (success: boolean) => {
      if (resolved) return;
      resolved = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(success);
    };

    // Connection timeout
    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.on("timeout", () => {
      log("warn", `doge-wallet: p2p: [${tag}] connection timed out`);
      finish(false);
    });

    socket.on("error", (err) => {
      log("warn", `doge-wallet: p2p: [${tag}] socket error: ${err.message}`);
      finish(false);
    });

    socket.on("close", () => {
      if (!resolved) {
        log("warn", `doge-wallet: p2p: [${tag}] connection closed unexpectedly`);
        finish(false);
      }
    });

    // Process incoming data for handshake
    socket.on("data", (chunk: Buffer) => {
      receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

      // Parse messages from the buffer
      while (receiveBuffer.length >= HEADER_SIZE) {
        const header = parseMessageHeader(receiveBuffer, network);
        if (!header) {
          // Invalid magic or malformed — skip a byte and retry
          receiveBuffer = receiveBuffer.subarray(1);
          continue;
        }

        const totalMessageLen = HEADER_SIZE + header.payloadLength;
        if (receiveBuffer.length < totalMessageLen) {
          // Not enough data yet — wait for more
          break;
        }

        // We have a complete message
        const cmd = header.command;

        // Consume this message from the buffer
        receiveBuffer = receiveBuffer.subarray(totalMessageLen);

        if (cmd === "version") {
          receivedVersion = true;
          log("info", `doge-wallet: p2p: [${tag}] received version`);
          // Respond with verack
          socket.write(buildVerackMessage(network));
        } else if (cmd === "verack") {
          receivedVerack = true;
          log("info", `doge-wallet: p2p: [${tag}] received verack`);
        } else if (cmd === "reject") {
          log("warn", `doge-wallet: p2p: [${tag}] received reject message`);
          finish(false);
          return;
        }
        // Ignore other messages (ping, addr, inv, etc.)

        // Check if handshake is complete
        if (receivedVersion && receivedVerack && !handshakeComplete) {
          handshakeComplete = true;
          log("info", `doge-wallet: p2p: [${tag}] handshake complete — sending tx`);

          // Remove the handshake timeout
          socket.setTimeout(0);

          // Send the transaction
          const txMsg = buildTxMessage(signedTxHex, network);
          socket.write(txMsg, () => {
            log("info", `doge-wallet: p2p: [${tag}] tx sent (${signedTxHex.length / 2} bytes)`);
            // Brief delay to let the peer process, then disconnect
            setTimeout(() => finish(true), POST_TX_DELAY_MS);
          });
        }
      }
    });

    // Connect
    log("info", `doge-wallet: p2p: [${tag}] connecting...`);
    socket.connect(peer.port, peer.ip, () => {
      log("info", `doge-wallet: p2p: [${tag}] connected — sending version`);

      // Switch to handshake timeout
      socket.setTimeout(HANDSHAKE_TIMEOUT_MS);

      // Send our version message
      const versionPayload = buildVersionPayload(peer.ip, peer.port);
      const versionMsg = buildMessage("version", versionPayload, network);
      socket.write(versionMsg);
    });
  });
}
