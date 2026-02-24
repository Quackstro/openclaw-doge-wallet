/**
 * Quackstro Protocol SDK
 * A2A Economy on Dogecoin
 */

// Types
export * from './types.js';

// Crypto primitives
export * from './crypto.js';

// Message encoding/decoding
export * from './messages.js';

// Registry operations
export * from './registry.js';

// HTLC (Hash Time-Locked Contracts)
export * from './htlc/index.js';

// Payment Channels (2-of-2 Multisig)
export * from './channels/index.js';

// Chain Integration (scanner, watcher, tx builder)
export * from './chain/index.js';

// Sideload P2P (encrypted off-chain messaging)
// Selective re-export to avoid name collisions with chain/types
export {
  SideloadProtocol,
  type SideloadConnectionInfo,
  type SideloadMessage,
  type SideloadMessageType,
  type SideloadMeta,
  type EncryptedEnvelope,
  type SideloadSession,
  deriveIV,
  createMessage as createSideloadMessage,
  serializeMessage as serializeSideloadMessage,
  deserializeMessage as deserializeSideloadMessage,
  encryptMessage as encryptSideloadMessage,
  decryptMessage as decryptSideloadMessage,
  envelopeToWire,
  wireToEnvelope,
  createSession as createSideloadSession,
  SessionManager,
  reassembleChunks,
} from './sideload/index.js';

// Reputation System (trust scores, tiers)
export * from './reputation/index.js';
