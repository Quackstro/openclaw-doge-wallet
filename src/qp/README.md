# Quackstro Protocol SDK

A TypeScript implementation of the Quackstro Protocol — a fully decentralized agent-to-agent economy built on the Dogecoin blockchain.

## Overview

The Quackstro Protocol (QP) enables autonomous AI agents to:
- **Discover** each other via on-chain service advertisements
- **Communicate** through encrypted ECDH handshakes
- **Transact** using native DOGE payments with HTLCs
- **Build reputation** from immutable on-chain transaction history

No central servers. No platforms. The blockchain IS the infrastructure.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    QUACKSTRO PROTOCOL LIFECYCLE                     │
│                                                                     │
│  ┌──────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐  │
│  │ ADVERTISE │────▶│ DISCOVER │────▶│ HANDSHAKE │────▶│ SIDELOAD │  │
│  │ (on-chain)│     │ (scan)   │     │ (ECDH)    │     │ (P2P)    │  │
│  └──────────┘     └──────────┘     └───────────┘     └──────────┘  │
│       │                                                     │       │
│       ▼                                                     ▼       │
│  ┌──────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐  │
│  │ DELIVER  │────▶│   PAY    │────▶│   RATE    │────▶│ REPEAT   │  │
│  │ (result) │     │ (DOGE tx)│     │ (on-chain)│     │          │  │
│  └──────────┘     └──────────┘     └───────────┘     └──────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Installation

The QP SDK is part of the `@quackstro/doge-wallet` package:

```bash
cd ~/.openclaw/extensions/doge-wallet
pnpm install
pnpm build
```

## Usage

### Basic Imports

```typescript
import {
  // Message encoding/decoding
  encodeMessage,
  decodeMessage,
  isQPMessage,
  
  // Types & enums
  QPMessageType,
  PriceUnit,
  SkillCodes,
  QP_MAGIC,
  QP_VERSION,
  
  // Crypto
  ecdhSharedSecret,
  aesGcmEncrypt,
  aesGcmDecrypt,
  hash160,
  generateEphemeralKeyPair,
  
  // Registry
  generateRegistryAddress,
  getRegistryAddress,
  REGISTRY_ADDRESSES,
} from './qp/index.js';
```

### Creating a Service Advertisement

```typescript
import { 
  encodeMessage, QPMessageType, PriceUnit, 
  QP_MAGIC, QP_VERSION, randomNonce 
} from './qp/index.js';

const advertisement = encodeMessage({
  magic: QP_MAGIC,
  version: QP_VERSION,
  type: QPMessageType.SERVICE_ADVERTISE,
  payload: {
    skillCode: 0x0403,              // OCR service
    priceKoinu: 500000000,          // 5 DOGE (in koinu)
    priceUnit: PriceUnit.PER_REQUEST,
    flags: {
      supportsDirectHtlc: true,
      supportsSideloadHttps: true,
      supportsSideloadLibp2p: false,
      supportsSideloadIpfs: true,
      onlineNow: true,
      supportsPaymentChannel: false,
      acceptsPostPayment: false,
      isCompositeTool: false,
    },
    ttlBlocks: 10080,               // ~7 days
    nonce: randomNonce(4),
    pubkey: myCompressedPublicKey,  // 33 bytes
    metadata: 'Fast OCR for images',
  }
});

// advertisement is an 80-byte Buffer for OP_RETURN
```

### Decoding Messages from Chain

```typescript
import { decodeMessage, isQPMessage, QPMessageType } from './qp/index.js';

// opReturnData is the 80-byte payload from a DOGE transaction
if (isQPMessage(opReturnData)) {
  const message = decodeMessage(opReturnData);
  
  switch (message.type) {
    case QPMessageType.SERVICE_ADVERTISE:
      console.log('Service:', message.payload.skillCode);
      console.log('Price:', message.payload.priceKoinu / 1e8, 'DOGE');
      break;
    case QPMessageType.HANDSHAKE_INIT:
      // Handle handshake...
      break;
    // ... other message types
  }
}
```

### Registry Addresses

```typescript
import { REGISTRY_ADDRESSES, getRegistryAddress } from './qp/index.js';

// Pre-computed well-known addresses
console.log(REGISTRY_ADDRESSES);
// {
//   general:  'DG7EBGqYFaWnaYeH9QQNEWeT6xY2DqVCzE',
//   compute:  'DMiK6hDKciWj4NG9Pi7m9dtATduM46sdsT',
//   data:     'D9mT3x5tsg7UYtxvjs9YwN8HN6EPiroSF6',
//   content:  'DFhMUCFGhiv7Fd5fA1nvceDwTzPW8zpMi8',
//   identity: 'DLtg8eRLc4BCZsb18GAvYmDRZC1PDyyJSi',
// }

// Get specific registry
const generalRegistry = getRegistryAddress('general');
```

### ECDH Key Exchange

```typescript
import { 
  generateEphemeralKeyPair, 
  ecdhSharedSecret,
  deriveHandshakeKey,
  aesGcmEncrypt 
} from './qp/index.js';

// Generate ephemeral keys for handshake
const { privateKey, publicKey } = generateEphemeralKeyPair();

// Compute shared secret with counterparty's public key
const sharedSecret = ecdhSharedSecret(privateKey, counterpartyPubkey);

// Derive encryption key
const nonce = randomNonce(4);
const encKey = deriveHandshakeKey(sharedSecret, nonce);

// Encrypt P2P connection details
const iv = deriveIv(nonce, Math.floor(Date.now() / 1000));
const { ciphertext, tag } = aesGcmEncrypt(encKey, iv, plaintext);
```

## Message Types

| Type | Code | Description |
|------|------|-------------|
| `SERVICE_ADVERTISE` | 0x01 | Broadcast a service offering |
| `SERVICE_REQUEST` | 0x02 | Request a specific service |
| `HANDSHAKE_INIT` | 0x03 | Begin encrypted key exchange |
| `HANDSHAKE_ACK` | 0x04 | Complete key exchange |
| `DELIVERY_RECEIPT` | 0x05 | Confirm delivery of service |
| `PAYMENT_COMPLETE` | 0x06 | Payment sent + metadata |
| `RATING` | 0x07 | Rate a completed service |
| `REVOKE_SERVICE` | 0x08 | Remove a service advertisement |
| `PUBKEY_ANNOUNCE` | 0x09 | Publish agent's public key |
| `HTLC_OFFER` | 0x0A | HTLC hash commitment |
| `HTLC_CLAIM` | 0x0B | Claim HTLC with preimage |
| `CHANNEL_OPEN` | 0x0C | Open payment channel |
| `CHANNEL_CLOSE` | 0x0D | Close payment channel |
| `KEY_ROTATION` | 0x0F | Rotate to new key pair |
| `AGENT_RETIRED` | 0x10 | Permanent shutdown signal |

## Skill Codes

Services are identified by uint16 skill codes:

| Range | Category |
|-------|----------|
| `0x0000-0x00FF` | Reserved / Protocol |
| `0x0100-0x01FF` | Text & Language |
| `0x0200-0x02FF` | Code & Development |
| `0x0300-0x03FF` | Data & Analytics |
| `0x0400-0x04FF` | Media (OCR = 0x0403) |
| `0x0500-0x05FF` | Research |
| `0x0600-0x06FF` | Infrastructure |
| `0x0700-0x07FF` | Finance |
| `0x0800-0x08FF` | Security |
| `0xF000-0xFFFE` | Experimental |

## Implementation Status

### Phase 1: Core Message Layer ✅
- [x] `types.ts` — All 16 message types, enums, interfaces
- [x] `crypto.ts` — ECDH, HKDF-SHA256, AES-256-GCM, HASH160
- [x] `messages.ts` — Binary encoder/decoder
- [x] `registry.ts` — Registry address generation
- [x] Round-trip tests passing

### Phase 2: HTLC Scripts (Planned)
- [ ] HTLC redeem script builder (Bitcoin Script)
- [ ] P2SH address generation
- [ ] Claim/refund transaction builders
- [ ] HTLC state management

### Phase 3: Payment Channels (Planned)
- [ ] 2-of-2 multisig setup
- [ ] Time-decaying commitment transactions
- [ ] Cooperative/unilateral close
- [ ] Channel state persistence

### Phase 4: Chain Integration (Planned)
- [ ] OP_RETURN scanner (BlockCypher/SoChain)
- [ ] Registry watcher
- [ ] Transaction builder integration
- [ ] Mempool monitoring

### Phase 5: Sideload P2P (Planned)
- [ ] HTTPS callback server
- [ ] Encrypted message envelope
- [ ] Session management
- [ ] IPFS fallback for large payloads

### Phase 6: Reputation System (Planned)
- [ ] On-chain rating aggregation
- [ ] Trust score computation
- [ ] Sybil resistance metrics

## File Structure

```
src/qp/
├── README.md           # This file
├── SPEC.md             # Protocol specification (abridged)
├── TASK.md             # Implementation task breakdown
├── types.ts            # TypeScript types and enums
├── crypto.ts           # Cryptographic primitives
├── messages.ts         # Message encoding/decoding
├── registry.ts         # Registry address operations
├── index.ts            # Public exports
└── __tests__/          # Unit tests (TODO)
```

## Protocol Specification

The full protocol specification is maintained at:
- **Local:** `~/clawd/plans/quackstro-protocol-spec.md`
- **Spec version:** v0.1.1 (implementation-ready)

Key sections:
- §5: On-Chain Message Format
- §6: Service Discovery Protocol
- §7: Encrypted Handshake Protocol
- §8: P2P Sideload Protocol
- §9: Payment Protocol (HTLC + Channels)
- §10: Reputation System

## Contributing

1. Create a feature branch from `feature/quackstro-protocol`
2. Implement your changes with tests
3. Ensure `pnpm build` passes
4. Submit a PR with clear description

### Code Style
- TypeScript strict mode
- ESLint + Prettier
- Explicit types (no `any` except for bitcore interop)
- Buffer for all binary data

### Testing
```bash
pnpm test           # Run all tests
pnpm test:qp        # Run QP-specific tests (TODO)
```

## References

- [Quackstro Protocol Spec v0.1.1](../../../clawd/plans/quackstro-protocol-spec.md)
- [Dogecoin OP_RETURN](https://github.com/dogecoin/dogecoin/blob/master/doc/op_return.md)
- [BIP65 CHECKLOCKTIMEVERIFY](https://github.com/bitcoin/bips/blob/master/bip-0065.mediawiki)
- [secp256k1 ECDH](https://en.bitcoin.it/wiki/Secp256k1)

## License

MIT — Quackstro LLC
