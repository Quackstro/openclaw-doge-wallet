# 🐕 Multi-Wallet Feature Plan

**Status:** ✅ Approved  
**Date:** 2026-02-05  
**Repo:** [Quackstro/openclaw-doge-wallet](https://github.com/Quackstro/openclaw-doge-wallet)

---

## 1. Goal

Allow a single DOGE wallet plugin to manage **multiple named wallets** for different purposes — savings, operations, agent-to-agent payments — each with its own address, balance, spending policy, and audit trail.

---

## 2. Wallet Types

| Type | Key Source | Lock Behavior | Use Case |
|------|-----------|---------------|----------|
| **HD** | Derived from master seed (BIP44 account index) | Manual unlock via passphrase (same as today) | General purpose, savings, project funds |
| **Independent** | Separate BIP39 mnemonic | Manual unlock via its own passphrase | High-security isolation, cold reserve |
| **A2A** | HD-derived or independent | **Auto-unlock on startup** — key stays decrypted in memory | Agent-to-agent autonomous payments |

### Unlock Behavior

**HD wallets** all derive from the same master seed. A single `/wallet unlock <passphrase>` unlocks all HD wallets simultaneously. Locking re-locks all of them.

**Independent wallets** each have their own mnemonic and passphrase. Each must be unlocked individually.

**A2A wallets** auto-unlock on startup — no human intervention needed (see below).

### A2A Auto-Unlock: How It Works

Today the wallet requires a manual `/wallet unlock <passphrase>` after every restart. A2A wallets eliminate this:

1. **During creation:** user provides the master passphrase (or a separate passphrase for independent A2A wallets)
2. **Plugin stores a derived unlock token** — an encrypted-at-rest passphrase envelope that the plugin can decrypt using a machine-bound key
3. **On plugin startup:** A2A wallets auto-decrypt their key material and enter an unlocked state — no human intervention needed
4. **Non-A2A wallets remain locked** until the user explicitly unlocks them
5. **Proactive migration export:** immediately after creation, a migration bundle is delivered via secure DM so the user can re-establish on a new machine if the machine ID changes

#### Auto-Unlock Security Model

```
┌─────────────────────────────────────────────────┐
│  A2A Wallet Auto-Unlock Flow                    │
│                                                 │
│  Startup                                        │
│    │                                            │
│    ├─ Load wallets.json                         │
│    ├─ Check machine ID — warn if drift detected │
│    ├─ For each A2A wallet:                      │
│    │   ├─ Read encrypted passphrase envelope    │
│    │   ├─ Decrypt with machine-bound key        │
│    │   ├─ Derive private key from seed          │
│    │   ├─ Cache in memory (never written plain) │
│    │   └─ Mark wallet as unlocked               │
│    │                                            │
│    └─ Non-A2A wallets: remain locked            │
│                                                 │
│  Runtime                                        │
│    ├─ A2A wallet: ready to sign immediately     │
│    └─ HD/Independent: require /wallet unlock    │
└─────────────────────────────────────────────────┘
```

**Machine-bound key:** Derived from stable machine ID (hostname + `/etc/machine-id` + salt) via scrypt. Override via `DOGE_A2A_SECRET` environment variable if preferred.

> **Note:** The auto-unlock secret protects *only* the A2A wallet. Master wallet keys remain behind the user's passphrase. If the machine is compromised, only A2A funds are at risk (which should be low-value by design).

---

## 3. Directory Structure

```
~/.openclaw/doge/
├── keys/                              # Master HD keystore (existing, unchanged)
├── wallets.json                       # Wallet registry
├── wallets/
│   ├── default/                       # Migrated from current flat structure
│   │   ├── utxos.json
│   │   ├── tracking.json
│   │   ├── limits.json
│   │   ├── alert-state.json
│   │   ├── rate-limit-state.json
│   │   ├── receive-state.json
│   │   ├── policy.json                # Per-wallet policy overrides (optional)
│   │   └── audit/
│   │       └── audit.jsonl
│   ├── savings/
│   │   ├── utxos.json
│   │   ├── ... (same structure)
│   │   └── policy.json
│   └── a2a-ops/
│       ├── keys/                       # If independent type
│       │   └── keystore.json
│       ├── auto-unlock.enc             # Encrypted passphrase envelope (A2A only)
│       ├── utxos.json
│       ├── ... (same structure)
│       └── policy.json
```

---

## 4. Wallet Registry (`wallets.json`)

```json
{
  "version": 1,
  "activeWallet": "default",
  "wallets": [
    {
      "id": "default",
      "name": "Default",
      "type": "hd",
      "accountIndex": 0,
      "address": "D6i8Tee...",
      "createdAt": "2026-02-05T11:00:00Z",
      "description": "Primary wallet (migrated)"
    },
    {
      "id": "savings",
      "name": "Savings",
      "type": "hd",
      "accountIndex": 1,
      "address": "DKx9f4p...",
      "createdAt": "2026-02-05T12:00:00Z",
      "description": "Long-term holdings"
    },
    {
      "id": "a2a-ops",
      "name": "A2A Operations",
      "type": "a2a",
      "keySource": "hd",
      "accountIndex": 2,
      "address": "DQm7rTn...",
      "createdAt": "2026-02-05T12:30:00Z",
      "description": "Agent-to-agent micro-transactions",
      "a2a": {
        "autoUnlock": true,
        "maxBalanceDoge": 100,
        "dailyLimitDoge": 50,
        "perTxLimitDoge": 10,
        "agentAccess": ["main"],
        "allowlist": ["DRecipientAddr1...", "DRecipientAddr2..."],
        "openSend": false,
        "autoFreezeRules": {
          "maxConsecutiveSends": 3,
          "windowSeconds": 60
        }
      }
    }
  ]
}
```

---

## 5. Commands & Tools

### New Commands

| Command | Description |
|---------|-------------|
| `/wallet create <name> --type hd\|independent\|a2a` | Create a new wallet |
| `/wallet list` | Show all wallets with balances |
| `/wallet switch <name>` | Set the active wallet |
| `/wallet info [name]` | Detailed info for one wallet |
| `/wallet rename <old> <new>` | Rename a wallet |
| `/wallet delete <name>` | Delete (must be empty, requires confirm) |
| `/wallet policy <name> --daily-limit 50 ...` | View/set per-wallet policy |
| `/wallet transfer <amount> from <src> to <dst>` | Inter-wallet transfer |
| `/wallet audit [name]` | View audit trail for a wallet |

### Tool Parameter Additions

All existing tools gain an optional `wallet` parameter:

```
wallet_balance(wallet?: "savings")     → balance for specific wallet
wallet_send(wallet?: "a2a-ops", ...)   → send from specific wallet  
wallet_address(wallet?: "savings")     → address for specific wallet
wallet_history(wallet?: "a2a-ops")     → history for specific wallet
```

Omitting `wallet` uses the active wallet — **fully backward compatible**.

---

## 6. Per-Wallet Policy Overrides

Each wallet can override the global spending policy:

```json
// wallets/savings/policy.json
{
  "tiers": {
    "micro": { "maxDoge": 1 },
    "small": { "maxDoge": 5, "action": "notify" },
    "medium": { "maxDoge": 20, "action": "delay", "delayMinutes": 15 },
    "large": { "action": "approve" }
  },
  "dailyLimitDoge": 25,
  "cooldownSeconds": 300
}
```

If no `policy.json` exists, the wallet inherits the global policy.

---

## 7. A2A Wallet — Constraints & Safeguards

### Hard-Coded Constraints (not overridable)

- ❌ Cannot be set as the active/default wallet
- ❌ Cannot disable audit logging
- ❌ Cannot disable rate limiting

### Configurable Safeguards (with enforced minimums)

| Safeguard | Default | Minimum |
|-----------|---------|---------|
| Daily spending limit | 50 DOGE | 1 DOGE |
| Per-transaction cap | 10 DOGE | 0.1 DOGE |
| Max consecutive sends (burst) | 3 in 60s | 2 in 30s |
| Max balance alert | 100 DOGE | 10 DOGE |

### Auto-Freeze Triggers

The A2A wallet auto-freezes (requires manual `/wallet unfreeze a2a-ops`) when:
1. Burst limit exceeded (3 sends in 60 seconds)
2. Daily limit hit
3. Send to a non-allowlisted address (allowlist is ON by default; set `openSend: true` to bypass)
4. Agent session cannot be attributed (unknown caller)

---

## 8. Migration Plan (Zero Downtime)

```
Current state:                After migration:
~/.openclaw/doge/             ~/.openclaw/doge/
├── keys/                     ├── keys/              (unchanged)
├── utxos.json         →      ├── wallets.json       (new)
├── tracking.json      →      ├── wallets/
├── limits.json        →      │   └── default/
├── alert-state.json   →      │       ├── utxos.json
├── rate-limit-state.json →   │       ├── tracking.json
├── receive-state.json →      │       ├── limits.json
└── audit/             →      │       ├── alert-state.json
                              │       ├── rate-limit-state.json
                              │       ├── receive-state.json
                              │       └── audit/
```

**Migration logic:**
1. On startup, check if `wallets.json` exists
2. If not, run auto-migration:
   - Create `wallets/default/` directory
   - Move existing data files into it
   - Generate `wallets.json` with single `default` entry
   - Log migration event to audit trail
3. If already migrated, load normally

---

## 9. ⚠️ A2A Security Documentation

> ### RISK DISCLOSURE — A2A Wallets
>
> **A2A wallets automatically unlock on startup and give agents direct spending access. This is intentional for autonomous operation but introduces real financial risk.**
>
> **You should understand:**
>
> - 🔓 **Keys in memory** — The A2A private key is decrypted and held in process memory at all times. If the host is compromised, the key is exposed.
> - 🤖 **Agent autonomy** — Agents can send funds without human approval. Bugs, hallucinations, or prompt injection could trigger unintended transactions.
> - ↩️ **No undo** — Dogecoin transactions are irreversible. Sent funds cannot be recovered.
> - 💸 **Recommended balance** — Keep only what you're prepared to lose. Think of it as cash in a vending machine, not a savings account.
> - 📊 **Monitor actively** — Review the A2A audit trail regularly. Set up alerts for unexpected spending patterns.
>
> **The safeguards (daily limits, burst protection, auto-freeze) reduce risk but do not eliminate it.** A determined attacker with host access can bypass software safeguards.
>
> **Bottom line:** A2A wallets trade security for autonomy. Fund them conservatively.

---

## 10. Implementation Phases

### Phase A: Foundation (~2-3 hours)
- [ ] `WalletRegistry` class — CRUD for `wallets.json`
- [ ] Auto-migration of existing single wallet to `wallets/default/`
- [ ] Multi-instance managers — `UtxoManager`, `TransactionTracker`, `AuditLog` per wallet
- [ ] HD derivation for arbitrary account indices
- [ ] HD shared unlock — one passphrase unlocks all HD wallets
- [ ] Commands: `/wallet create`, `/wallet list`, `/wallet switch`, `/wallet info`
- [ ] Tool: `wallet` parameter on `wallet_balance`, `wallet_address`
- [ ] Onboarding integration — after main wallet setup, prompt to create additional wallets (Savings, Operations, A2A)

### Phase B: Isolation & Sends (~2-3 hours)
- [ ] Per-wallet `PolicyEngine` + `LimitTracker`
- [ ] Per-wallet `AlertStateManager` + `ReceiveMonitor`
- [ ] `from <wallet>` on `/send` and `wallet_send`
- [ ] Inter-wallet transfers (`/wallet transfer`)
- [ ] Per-wallet audit trail
- [ ] Tool: `wallet` parameter on `wallet_send`, `wallet_history`

### Phase C: A2A Wallet Type (~2-3 hours)
- [ ] Auto-unlock mechanism (machine-bound key envelope, machine ID default + env var override)
- [ ] Machine ID drift detection on startup with warning
- [ ] A2A wallet creation flow with security confirmation + allowlist prompt
- [ ] Proactive migration export bundle delivered at creation time via secure DM
- [ ] Migration import flow (`/wallet import`)
- [ ] A2A-specific safeguards (burst detection, auto-freeze, allowlist enforcement)
- [ ] A2A policy enforcement (hard limits, no-default constraint, `openSend` bypass flag)
- [ ] Agent session attribution in audit
- [ ] Security documentation (in-app + README)

### Phase D: Polish & Hardening (~1-2 hours)
- [ ] Multi-wallet dashboard (`/wallet dashboard`)
- [ ] Independent wallet support (separate seeds + per-wallet passphrase)
- [ ] Comprehensive test suite
- [ ] README + user guide updates
- [ ] Edge cases: delete wallet with pending TXs, rename active wallet, etc.

---

## 11. Decisions (Resolved 2026-02-05)

**Q1: Machine-bound key for A2A auto-unlock**
✅ Machine ID (hostname + install UUID + salt via scrypt) as default, environment variable as override.
- Migration export/import flow baked in
- Proactive export bundle delivered during A2A wallet creation (user has it from day one)
- Startup warning if machine ID drift detected

**Q2: A2A destination allowlist**
✅ Allowlist ON by default for A2A wallets. Bypass via explicit `openSend: true` for power users.
- Prompted to add addresses during A2A creation
- Sends to non-listed addresses auto-freeze the wallet
- HD/Independent wallets unaffected — normal policy engine
- Covers both A2A and B2B automation scenarios

**Q3: Max wallet count**
✅ Soft cap of 10. Warn but allow override with explicit confirmation.

**Q4: Independent wallet UX**
✅ Reuse full onboarding flow (mnemonic generation → display → 3-word verification) plus import option for existing mnemonics.

**Q5: Notification routing**
✅ All notifications to one channel by default, with optional per-wallet override for routing to different channels/threads.

## 12. Additional Requirements (from review)

- **Onboarding integration:** After main wallet setup, prompt user "Would you like to create additional wallets?" and suggest common setups (Savings, Operations, A2A). User can pick any, all, or skip.
- **Telegram formatting:** No markdown tables in chat output — use plain text lists for legibility.
- **Decision review style:** Present open questions one at a time, discuss, decide, then move to next.

---

*All decisions locked in. Ready to build Phase A.*
