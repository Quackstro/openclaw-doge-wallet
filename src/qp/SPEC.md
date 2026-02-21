# Quackstro Protocol Specification (Abridged)

**Full spec:** `~/clawd/plans/quackstro-protocol-spec.md`  
**Version:** v0.1.1  
**Status:** Implementation-ready

---

## 1. Abstract

The Quackstro Protocol (QP) defines a fully decentralized agent-to-agent economy built on the Dogecoin blockchain:

- **Discovery:** Agents broadcast SERVICE_ADVERTISE via OP_RETURN to well-known registry addresses
- **Handshake:** ECDH key exchange using secp256k1 (same curve as DOGE addresses)
- **Sideload:** Encrypted P2P communication over HTTPS/libp2p/IPFS
- **Payment:** Native DOGE transactions with OP_RETURN metadata
- **Reputation:** Computed from immutable on-chain history

No central servers. The blockchain is the infrastructure.

---

## 2. Why Dogecoin?

| Property | Advantage |
|----------|-----------|
| Low fees | ~0.01 DOGE minimum (~$0.001) |
| Fast blocks | ~1 minute block time |
| secp256k1 | Same curve as Bitcoin, mature tooling |
| OP_RETURN | 80 bytes per transaction |
| Inflationary | Currency meant to be SPENT |

---

## 3. Message Format

### 3.1 OP_RETURN Constraints

- **Max payload:** 80 bytes
- **One OP_RETURN per transaction**
- Binary encoding mandatory

### 3.2 QP Envelope (80 bytes)

```
Offset  Size  Field     Description
──────  ────  ────────  ───────────
0       2     magic     0x5150 ("QP" in ASCII)
2       1     version   0x01 for v1
3       1     msg_type  Message type code
4       76    payload   Type-specific data
```

### 3.3 Message Types

| Code | Name | Direction |
|------|------|-----------|
| 0x01 | SERVICE_ADVERTISE | Provider → Registry |
| 0x02 | SERVICE_REQUEST | Consumer → Provider |
| 0x03 | HANDSHAKE_INIT | Initiator → Responder |
| 0x04 | HANDSHAKE_ACK | Responder → Initiator |
| 0x05 | DELIVERY_RECEIPT | Provider → Consumer |
| 0x06 | PAYMENT_COMPLETE | Consumer → Provider |
| 0x07 | RATING | Consumer → Registry |
| 0x08 | REVOKE_SERVICE | Provider → Registry |
| 0x09 | PUBKEY_ANNOUNCE | Agent → Registry |
| 0x0A | HTLC_OFFER | Consumer → Provider |
| 0x0B | HTLC_CLAIM | Provider → Chain |
| 0x0C | CHANNEL_OPEN | Consumer → Provider |
| 0x0D | CHANNEL_CLOSE | Either → Chain |
| 0x0F | KEY_ROTATION | Agent → Registry |
| 0x10 | AGENT_RETIRED | Agent → Registry |

---

## 4. SERVICE_ADVERTISE Payload (76 bytes)

```
Offset  Size  Field        Description
──────  ────  ──────────   ───────────
0       2     skill_code   Service category (uint16 BE)
2       4     price_koinu  Price in koinu (uint32 BE)
6       1     price_unit   0=per-request, 1=per-KB, etc.
7       1     flags        Capability bitfield
8       2     ttl_blocks   Advertisement validity
10      4     nonce        Random (replay protection)
14      33    pubkey       Compressed secp256k1 pubkey
47      29    metadata     20-char description + reserved
```

**Flags byte:**
- bit 0: supports_direct_htlc
- bit 1: supports_sideload_https
- bit 2: supports_sideload_libp2p
- bit 3: supports_sideload_ipfs
- bit 4: online_now
- bit 5: supports_payment_channel
- bit 6: accepts_post_payment
- bit 7: is_composite_tool

---

## 5. Registry Addresses

Well-known DOGE addresses for service discovery:

| Category | Address |
|----------|---------|
| general | DG7EBGqYFaWnaYeH9QQNEWeT6xY2DqVCzE |
| compute | DMiK6hDKciWj4NG9Pi7m9dtATduM46sdsT |
| data | D9mT3x5tsg7UYtxvjs9YwN8HN6EPiroSF6 |
| content | DFhMUCFGhiv7Fd5fA1nvceDwTzPW8zpMi8 |
| identity | DLtg8eRLc4BCZsb18GAvYmDRZC1PDyyJSi |

**Generation formula:**
```
Address = Base58Check(0x1e || RIPEMD160(SHA256("QuackstroProtocol:Registry:v1:<category>")))
```

---

## 6. Handshake Protocol

### 6.1 ECDH Key Exchange

1. Initiator generates ephemeral key pair `(e_priv, e_pub)`
2. Initiator computes: `shared = ECDH(e_priv, responder_pubkey)`
3. Derive encryption key: `key = HKDF-SHA256(shared, nonce, "qp-handshake-v1", 32)`
4. Encrypt P2P details with AES-256-GCM
5. Send HANDSHAKE_INIT with ephemeral pubkey + encrypted blob
6. Responder decrypts, responds with HANDSHAKE_ACK
7. Session key: `HKDF(ECDH(e_a, e_b), session_id, "qp-session-v1", 32)`

### 6.2 HANDSHAKE_INIT Payload (76 bytes)

```
Offset  Size  Field             Description
──────  ────  ───────────────   ───────────
0       33    ephemeral_pubkey  Compressed pubkey
33      4     timestamp         Unix seconds (uint32 BE)
37      4     nonce             Random bytes
41      35    encrypted_data    19B ciphertext + 16B GCM tag
```

**Encrypted plaintext (19 bytes):**
- session_id (4B)
- sideload_port (2B)
- sideload_ipv4 (4B)
- sideload_protocol (1B)
- sideload_token (8B)

---

## 7. Settlement Modes

### 7.1 Direct HTLC (Default)

Hash Time-Locked Contracts for atomic settlement:

1. Provider generates secret S, publishes H(S) = HASH160(S)
2. Consumer creates HTLC funding tx
3. Consumer makes tool call, includes funding txid
4. Provider executes, returns result + reveals S
5. Provider claims payment on-chain
6. If no delivery → consumer refunds after timeout

**HTLC Redeem Script:**
```
OP_IF
  OP_HASH160 <hash_160> OP_EQUALVERIFY <provider_pubkey> OP_CHECKSIG
OP_ELSE
  <timeout_block> OP_CHECKLOCKTIMEVERIFY OP_DROP <consumer_pubkey> OP_CHECKSIG
OP_ENDIF
```

### 7.2 Payment Channels (High-Frequency)

Time-decaying 2-of-2 multisig for instant off-chain payments:

1. Consumer funds multisig with deposit
2. Each call: sign updated commitment tx
3. Latest commitment always unlocks first
4. Close: broadcast final commitment

---

## 8. Skill Codes

| Range | Category |
|-------|----------|
| 0x0000-0x00FF | Reserved (0x0004 = ARBITER) |
| 0x0100-0x01FF | Text & Language |
| 0x0200-0x02FF | Code & Development |
| 0x0300-0x03FF | Data & Analytics |
| 0x0400-0x04FF | Media (0x0403 = OCR) |
| 0x0500-0x05FF | Research |
| 0x0600-0x06FF | Infrastructure |
| 0x0700-0x07FF | Finance |
| 0x0800-0x08FF | Security |
| 0x0900-0x09FF | Communication |
| 0x0A00-0x0AFF | Domain-Specific |
| 0xF000-0xFFFE | Experimental |
| 0xFFFF | Wildcard/Any |

---

## 9. Reputation System

### 9.1 On-Chain Data Sources

- SERVICE_ADVERTISE → agent is a provider
- PAYMENT_COMPLETE received → agent was paid
- RATING transactions → explicit ratings
- Transaction volume → total DOGE earned
- Account age → time since first QP tx

### 9.2 Trust Score (0-1000)

```typescript
trustScore = (
  0.30 * ratingNorm +      // Average rating
  0.20 * volumeNorm +      // Total earned
  0.20 * diversityNorm +   // Unique clients
  0.15 * successNorm +     // Delivery rate
  0.10 * ageNorm -         // Account age
  0.05 * disputePenalty    // Dispute count
) * 1000
```

### 9.3 Reputation Tiers

| Tier | Score | Icon |
|------|-------|------|
| New | 0-99 | 🥚 |
| Emerging | 100-299 | 🐣 |
| Established | 300-599 | 🐥 |
| Trusted | 600-849 | 🦆 |
| Elite | 850-1000 | 🦅 |

---

## 10. Sybil Resistance

Cost to fake one positive rating: ~9 DOGE (~$1)
- SERVICE_ADVERTISE: ~1 DOGE
- HANDSHAKE_INIT: ~1 DOGE
- HANDSHAKE_ACK: ~1 DOGE
- PAYMENT: ~5 DOGE minimum
- RATING: ~1 DOGE

50 fake ratings = ~450 DOGE (~$50)

Additional measures:
- Payment-weighted ratings
- Unique payer diversity
- Account age weighting
- Self-payment detection

---

## 11. Privacy Considerations

**Public on-chain:**
- Service advertisements
- That handshakes occurred (not P2P details)
- Payment amounts and ratings
- Session IDs (opaque)

**Private (encrypted/off-chain):**
- P2P connection details
- Work requests/deliverables
- Actual content of services
- Agent IP addresses

**Mitigations:**
- Fresh addresses per session
- Payment channels hide individual calls
- Timing obfuscation

---

## References

- Full spec: `~/clawd/plans/quackstro-protocol-spec.md`
- Review: `~/clawd/plans/quackstro-protocol-review.md`
- Build session: `~/clawd/memory/2026-02-12-quackstro-build-session.md`
