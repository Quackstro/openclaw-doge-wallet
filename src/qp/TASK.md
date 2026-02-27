# Quackstro Protocol SDK — Phase 1 Implementation

## Context
You're implementing the Quackstro Protocol (QP) — a decentralized agent-to-agent economy on Dogecoin.

**Full spec:** `~/clawd/plans/quackstro-protocol-spec.md` (read key sections!)

## Phase 1 Scope: Core Message Layer + Registry

### Deliverables

#### 1. `messages.ts` — Binary Message Encoder/Decoder
All 16 QP message types from spec §5:

```typescript
// QP Envelope (80 bytes total in OP_RETURN)
// - magic: 0x5150 ("QP") - 2 bytes
// - version: 0x01 - 1 byte  
// - msg_type: uint8 - 1 byte
// - payload: 76 bytes

enum QPMessageType {
  SERVICE_ADVERTISE = 0x01,
  SERVICE_REQUEST = 0x02,
  HANDSHAKE_INIT = 0x03,
  HANDSHAKE_ACK = 0x04,
  DELIVERY_RECEIPT = 0x05,
  PAYMENT_COMPLETE = 0x06,
  RATING = 0x07,
  REVOKE_SERVICE = 0x08,
  PUBKEY_ANNOUNCE = 0x09,
  HTLC_OFFER = 0x0A,
  HTLC_CLAIM = 0x0B,
  CHANNEL_OPEN = 0x0C,
  CHANNEL_CLOSE = 0x0D,
  KEY_ROTATION = 0x0F,
  AGENT_RETIRED = 0x10
}
```

Key message: SERVICE_ADVERTISE (76 byte payload):
- skill_code: uint16 BE (2 bytes)
- price_koinu: uint32 BE (4 bytes)  
- price_unit: uint8 (1 byte)
- flags: uint8 (1 byte)
- ttl_blocks: uint16 BE (2 bytes)
- nonce: 4 bytes
- pubkey: 33 bytes (compressed secp256k1)
- metadata: 29 bytes (20 char description + 9 reserved)

#### 2. `crypto.ts` — Cryptographic Primitives
```typescript
// ECDH shared secret derivation
function ecdhSharedSecret(privateKey: Buffer, publicKey: Buffer): Buffer

// HKDF-SHA256 for session key derivation
function hkdfDerive(ikm: Buffer, salt: Buffer, info: string, length: number): Buffer

// AES-256-GCM encrypt/decrypt
function aesGcmEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer): { ciphertext: Buffer, tag: Buffer }
function aesGcmDecrypt(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer): Buffer

// HASH160 = RIPEMD160(SHA256(data))
function hash160(data: Buffer): Buffer
```

#### 3. `registry.ts` — Registry Address Operations
```typescript
// Generate well-known registry addresses
// Formula: Base58Check(0x1e || HASH160(SHA256("QuackstroProtocol:Registry:v1:<category>")))

function generateRegistryAddress(category: string): string

// Expected values (MUST match):
// general: DG7EBGqYFaWnaYeH9QQNEWeT6xY2DqVCzE
// compute: DMiK6hDKciWj4NG9Pi7m9dtATduM46sdsT
// data: D9mT3x5tsg7UYtxvjs9YwN8HN6EPiroSF6
// content: DFhMUCFGhiv7Fd5fA1nvceDwTzPW8zpMi8
// identity: DLtg8eRLc4BCZsb18GAvYmDRZC1PDyyJSi
```

#### 4. `types.ts` — TypeScript Interfaces
All protocol types, skill codes enum, etc.

#### 5. `index.ts` — Clean Exports

### Implementation Notes
- Use `bitcore-lib-doge` (check parent package.json for exact version)
- Use Node.js `crypto` module for AES-GCM and HKDF
- Big-endian for all multi-byte integers
- Tests in `__tests__/` directory

### Success Criteria
- Clean TypeScript build: `cd ~/.openclaw/extensions/doge-wallet && pnpm build`
- Registry addresses match spec values
- Message round-trip tests pass (encode → decode → equals original)

### NOT in scope (Phase 2+):
- HTLC script building (actual Bitcoin Script)
- Payment channels
- Sideload P2P connections
- Reputation calculations
