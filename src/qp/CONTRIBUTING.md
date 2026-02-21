# Contributing to Quackstro Protocol SDK

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Basic understanding of:
  - TypeScript
  - Dogecoin/Bitcoin transactions
  - Elliptic curve cryptography (secp256k1)

### Setup

```bash
# Clone the repo
git clone https://github.com/Quackstro/openclaw-doge-wallet.git
cd openclaw-doge-wallet

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test
```

### Branch Structure

- `main` — stable releases
- `feature/quackstro-protocol` — QP SDK development
- `feature/qp-*` — specific QP features

## Implementation Phases

### Phase 1: Core Message Layer ✅ COMPLETE

**Files:** `types.ts`, `crypto.ts`, `messages.ts`, `registry.ts`, `index.ts`

What's done:
- All 16 message type definitions
- Binary encoder/decoder
- ECDH, HKDF, AES-256-GCM primitives
- Registry address generation

### Phase 2: HTLC Scripts 🔲 OPEN FOR CONTRIBUTION

**Goal:** Build HTLC redeem scripts for atomic tool-call settlement

**Files to create:**
- `htlc/script.ts` — Bitcoin Script builder
- `htlc/address.ts` — P2SH address generation
- `htlc/transactions.ts` — Claim/refund tx builders
- `htlc/manager.ts` — HTLC lifecycle state machine

**Key references:**
- Spec §9.1 (Direct HTLC)
- `bitcore-lib-doge` Script class

**Example implementation target:**

```typescript
// htlc/script.ts
export function buildHTLCRedeemScript(params: {
  secretHash: Buffer;      // 20 bytes HASH160
  providerPubkey: Buffer;  // 33 bytes compressed
  consumerPubkey: Buffer;  // 33 bytes compressed
  timeoutBlock: number;    // absolute block height
}): Buffer;

export function createHTLCFundingTx(params: {
  redeemScript: Buffer;
  amount: number;          // in koinu
  utxos: UTXO[];
  changeAddress: string;
}): Transaction;

export function createClaimTx(params: {
  fundingTxId: string;
  fundingOutputIndex: number;
  secret: Buffer;          // 32 bytes preimage
  redeemScript: Buffer;
  providerPrivkey: Buffer;
  providerAddress: string;
}): Transaction;
```

### Phase 3: Payment Channels 🔲 OPEN FOR CONTRIBUTION

**Goal:** 2-of-2 multisig payment channels with time-decaying commitments

**Files to create:**
- `channels/multisig.ts` — 2-of-2 P2SH setup
- `channels/commitment.ts` — Commitment tx builder
- `channels/state.ts` — Channel state management
- `channels/close.ts` — Cooperative/unilateral close

**Key concepts:**
- Time-decaying model (latest commitment unlocks first)
- No penalty transactions (simpler than Lightning)
- Commitment sequence: higher seq = earlier unlock

### Phase 4: Chain Scanner 🔲 OPEN FOR CONTRIBUTION

**Goal:** Monitor DOGE blockchain for QP messages

**Files to create:**
- `scanner/watcher.ts` — Registry address monitor
- `scanner/parser.ts` — OP_RETURN extraction
- `scanner/providers.ts` — BlockCypher/SoChain adapters
- `scanner/cache.ts` — Local ad cache

**API targets:**
- BlockCypher: `https://api.blockcypher.com/v1/doge/main`
- SoChain: `https://sochain.com/api/v3`

### Phase 5: Sideload P2P 🔲 OPEN FOR CONTRIBUTION

**Goal:** Encrypted off-chain communication

**Files to create:**
- `sideload/server.ts` — HTTPS callback endpoint
- `sideload/client.ts` — Connection initiator
- `sideload/envelope.ts` — Encrypted message format
- `sideload/session.ts` — Session state management

**Message envelope:**
```typescript
interface SideloadMessage {
  v: 1;
  t: 'request' | 'response' | 'chunk' | 'done' | 'error';
  id: string;
  ref?: string;
  seq?: number;
  ts: number;
  body: Buffer | object;
  meta?: {
    content_type?: string;
    total_chunks?: number;
    sha256?: string;
  };
}
```

### Phase 6: Reputation System 🔲 OPEN FOR CONTRIBUTION

**Goal:** Compute trust scores from on-chain data

**Files to create:**
- `reputation/aggregator.ts` — Collect rating data
- `reputation/scorer.ts` — Trust score computation
- `reputation/tiers.ts` — Tier classification

## Code Standards

### TypeScript

```typescript
// ✅ Good: Explicit types
function encodePayload(type: QPMessageType, payload: QPPayload): Buffer

// ❌ Bad: Implicit any
function encodePayload(type, payload)

// ✅ Good: Buffer for binary data
const pubkey: Buffer = Buffer.alloc(33);

// ❌ Bad: Uint8Array mixing
const pubkey: Uint8Array = new Uint8Array(33);
```

### Binary Encoding

```typescript
// Always use Big Endian for multi-byte integers
buffer.writeUInt16BE(value, offset);  // ✅
buffer.writeUInt16LE(value, offset);  // ❌

// Copy buffers explicitly
source.copy(dest, offset, 0, length);  // ✅
```

### Error Handling

```typescript
// Throw descriptive errors
if (buffer.length !== 80) {
  throw new Error(`Invalid message size: ${buffer.length}, expected 80`);
}

// Validate inputs early
if (!isValidPublicKey(pubkey)) {
  throw new Error('Invalid public key');
}
```

### Testing

Each module should have corresponding tests:

```
src/qp/
├── messages.ts
├── __tests__/
│   └── messages.test.ts
```

Test patterns:
```typescript
describe('encodeMessage', () => {
  it('should encode SERVICE_ADVERTISE to 80 bytes', () => {
    const msg = createTestAdvertise();
    const encoded = encodeMessage(msg);
    expect(encoded.length).toBe(80);
  });

  it('should round-trip SERVICE_ADVERTISE', () => {
    const original = createTestAdvertise();
    const encoded = encodeMessage(original);
    const decoded = decodeMessage(encoded);
    expect(decoded.payload).toEqual(original.payload);
  });
});
```

## Pull Request Process

1. **Branch from** `feature/quackstro-protocol`
2. **Name your branch** `feature/qp-<feature>` (e.g., `feature/qp-htlc-scripts`)
3. **Write tests** for new functionality
4. **Update docs** if adding new exports or changing APIs
5. **Run checks:**
   ```bash
   pnpm build      # Must pass
   pnpm test       # Must pass
   pnpm lint       # Should pass
   ```
6. **Submit PR** with clear description of changes

### PR Template

```markdown
## Summary
Brief description of changes

## Type
- [ ] Feature (new functionality)
- [ ] Fix (bug fix)
- [ ] Refactor (no functional change)
- [ ] Docs (documentation only)

## Phase
- [ ] Phase 2: HTLC Scripts
- [ ] Phase 3: Payment Channels
- [ ] Phase 4: Chain Scanner
- [ ] Phase 5: Sideload P2P
- [ ] Phase 6: Reputation

## Testing
- [ ] Unit tests added
- [ ] Manual testing done
- [ ] Round-trip tests pass

## Checklist
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] Documentation updated
```

## Architecture Decisions

### Why bitcore-lib-doge?

- Native DOGE support (addresses, transactions)
- Bitcoin Script building
- Well-tested crypto primitives
- Same library used by main wallet

### Why not separate secp256k1 package?

- bitcore-lib-doge bundles elliptic curve operations
- Avoid dependency conflicts
- Consistent API with rest of wallet

### Why Buffer over Uint8Array?

- Node.js native
- Better tooling support
- Consistent with bitcore-lib-doge

## Questions?

- Open an issue on GitHub
- Check the full spec: `~/clawd/plans/quackstro-protocol-spec.md`
- Review the spec review: `~/clawd/plans/quackstro-protocol-review.md`
