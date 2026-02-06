# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-02-06

### Security
- **Auto-delete sensitive messages** — `/wallet unlock`, `/wallet recover`, and `/wallet export` messages are now auto-deleted from Telegram chat immediately after processing
- **Auto-delete mnemonic display** — The bot's recovery phrase message is auto-deleted when user clicks "I've Written It Down"
- **SECURITY.md** — Added Telegram message security section with manual deletion guidance

### Changed
- **Receive monitor** default poll interval reduced from 10 minutes to 30 seconds (~17% of free-tier BlockCypher quota)
- `/wallet address` now outputs only the raw address string for easy copy-paste

## [0.1.0] - 2026-02-06

### Security Fixes (Post-Audit)

Based on the [security audit](./SECURITY-AUDIT.md) performed by Claude Opus 4.6 on 2026-02-06:

#### Critical
- **C-1:** `getPrivateKey()` now returns a defensive copy (`Buffer.from()`) instead of the live internal buffer — prevents callers from corrupting the wallet's signing key (`src/keys/manager.ts`)
- **C-2:** Added prominent JSDoc warning about JS string mnemonic limitation; added `global.gc?.()` hint after wallet init (`src/keys/manager.ts`)

#### High
- **H-1:** `signTransaction()` now zeros the input `privateKey` buffer in its `finally` block — prevents key material from lingering in memory (`src/tx/signer.ts`)
- **H-2:** Onboarding passphrase references deleted immediately after wallet init to minimize memory exposure window (`src/onboarding/flow.ts`). Note: JS strings cannot be truly zeroed — this is a documented architectural limitation.
- **H-3:** `ApprovalQueue.approve()` and `.deny()` now verify caller identity against configured `ownerId` — prevents unauthorized approval by prompt-injected agents (`src/policy/approval.ts`)
- **H-4:** BlockCypher provider enforces HTTPS, sanitizes tokens from error messages, and documents the inherent query-param token limitation (`src/api/blockcypher.ts`)

#### Medium
- **M-1:** Added `selectAndLock()` method to `UtxoManager` — atomic coin selection + locking in a single mutex operation, eliminating the race window between selection and broadcast (`src/utxo/manager.ts`)
- **M-3:** `verifyPayment()` now rejects already-settled invoices (status ≠ pending) to prevent replay attacks (`src/a2a/verification.ts`)

### Initial Release
- Full self-custodial DOGE wallet with BIP39/BIP44 HD key derivation
- AES-256-GCM encrypted keystore with scrypt KDF
- Transaction building, signing, and broadcasting
- UTXO management with coin selection and consolidation
- Tier-based spending policy engine with approval queue
- Agent-to-agent (A2A) invoice and payment verification system
- P2P transaction broadcasting
- Guided onboarding flow with mnemonic backup verification
- Multi-provider API with automatic failover (BlockCypher, SoChain)
- Comprehensive audit logging
- Rate limiting and error sanitization
