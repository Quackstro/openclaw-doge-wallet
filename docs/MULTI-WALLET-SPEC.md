# Multi-Wallet Architecture — Design Spec

**Status:** Draft  
**Date:** 2026-02-05  
**Issue:** TBD

---

## Overview

Support multiple named wallets within a single DOGE wallet plugin instance. Wallets can be **HD-derived** (from the master seed) or **independent** (separate seed). A special **A2A wallet type** exposes keys to agents for autonomous operation.

## Wallet Types

### 1. HD-Derived (default)
- Derived from master mnemonic via BIP44: `m/44'/3'/<account>'/0/0`
- Account index auto-incremented per wallet
- One backup covers all HD wallets
- Shared master key risk — documented

### 2. Independent
- Separate BIP39 mnemonic, fully isolated
- Must be backed up independently
- For high-security or cold-reserve use cases

### 3. A2A (Agent-to-Agent) — extends HD or Independent
- Keys accessible to agents without manual unlock
- Designed for autonomous micro-transactions
- **Mandatory safeguards:**
  - Low daily spending limit (configurable, default 50 DOGE)
  - Low balance cap with warnings
  - Auto-freeze if anomalous spending detected
  - Separate audit trail with full agent attribution
  - Cannot be set as default wallet
  - Prominent warnings during creation

## Directory Structure

```
~/.openclaw/doge/
├── keys/                          # Master keystore (existing)
├── wallets.json                   # Wallet registry/manifest
├── wallets/
│   ├── default/                   # Default wallet (migrated from current)
│   │   ├── utxos.json
│   │   ├── tracking.json
│   │   ├── alert-state.json
│   │   ├── limits.json
│   │   ├── rate-limit-state.json
│   │   └── audit/
│   ├── savings/
│   │   ├── utxos.json
│   │   ├── tracking.json
│   │   ├── ...
│   │   └── policy.json            # Per-wallet policy overrides
│   └── a2a-ops/
│       ├── keys/                   # Independent key (if standalone)
│       ├── utxos.json
│       ├── tracking.json
│       ├── ...
│       └── policy.json
```

## Wallet Registry (`wallets.json`)

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
      "createdAt": "2026-02-05T...",
      "description": "Primary wallet"
    },
    {
      "id": "savings",
      "name": "Savings",
      "type": "hd",
      "accountIndex": 1,
      "createdAt": "2026-02-05T...",
      "description": "Long-term holdings",
      "policyOverrides": {
        "tiers": { "micro": 1, "small": 5 },
        "dailyLimit": 10
      }
    },
    {
      "id": "a2a-ops",
      "name": "A2A Operations",
      "type": "a2a",
      "keySource": "hd",
      "accountIndex": 2,
      "createdAt": "2026-02-05T...",
      "description": "Agent-to-agent micro-transactions",
      "a2a": {
        "autoUnlock": true,
        "maxBalance": 100,
        "dailyLimit": 50,
        "agentAccess": ["main"]
      }
    }
  ]
}
```

## Commands

```
/wallet create <name> [--type hd|independent|a2a] [--description "..."]
/wallet list                       → table of all wallets + balances
/wallet switch <name>              → set active wallet
/wallet info [name]                → details for a specific wallet
/wallet rename <old> <new>
/wallet delete <name>              → requires confirmation, must be empty
/wallet policy <name> [overrides]  → view/set per-wallet policy

/send 5 DOGE to DAddr              → uses active wallet
/send 5 DOGE to DAddr from savings → explicit source
/wallet transfer 10 DOGE from default to savings  → inter-wallet
```

## Tool Changes

```
wallet_send     → add optional `wallet` parameter
wallet_balance  → add optional `wallet` parameter, or return all
wallet_address  → add optional `wallet` parameter
wallet_history  → add optional `wallet` parameter
```

## Migration Path

1. Current single-wallet state becomes `default` wallet
2. Move existing data into `wallets/default/`
3. Create `wallets.json` with single entry
4. All existing tool calls work unchanged (default wallet assumed)
5. Zero breaking changes

## A2A Wallet — Security Documentation

### ⚠️ IMPORTANT: A2A Wallet Risk Disclosure

A2A wallets grant autonomous agents direct access to private keys. This means:

1. **Funds at risk**: Any agent with access can spend funds without human approval
2. **No recovery**: Transactions on the Dogecoin network are irreversible
3. **Software bugs**: Agent errors, prompt injection, or plugin bugs could trigger unintended sends
4. **Attack surface**: A compromised agent session could drain the A2A wallet
5. **Recommended balance**: Keep only what you're willing to lose (suggested: < 100 DOGE)

### Safeguards (enforced by default)

- Hard daily spending limit (default: 50 DOGE, configurable)
- Per-transaction cap (default: 10 DOGE)
- Auto-freeze after 3 consecutive sends within 60 seconds
- Balance cap alert — warns when A2A wallet exceeds configured max
- Full audit trail with agent session attribution
- Cannot be set as the global default wallet
- Separate rate limiter from other wallets

### Best Practices

- Fund the A2A wallet with small amounts frequently rather than large deposits
- Review the A2A audit trail regularly (`/wallet audit a2a-ops`)
- Set conservative daily limits relative to your risk tolerance
- Use the inter-wallet transfer to move excess funds to savings
- Monitor via low-balance + high-balance alerts

## Implementation Phases

### Phase A: Foundation
- [ ] Wallet registry (`wallets.json`) + `WalletRegistry` class
- [ ] Directory structure + migration of existing single wallet to `default`
- [ ] Multi-wallet `UtxoManager` — one instance per wallet
- [ ] HD derivation for multiple account indices
- [ ] `wallet create`, `wallet list`, `wallet switch`

### Phase B: Per-Wallet Isolation
- [ ] Per-wallet policy engine + spending limits
- [ ] Per-wallet tracker, audit, alerts
- [ ] `from <wallet>` parameter on send
- [ ] Inter-wallet transfers
- [ ] Tool parameter additions (`wallet` param)

### Phase C: A2A Wallet Type
- [ ] A2A auto-unlock mechanism (key derived + cached for agent access)
- [ ] A2A-specific safeguards (rate limits, caps, anomaly detection)
- [ ] A2A security documentation + creation warnings
- [ ] Agent attribution in audit trail

### Phase D: Polish
- [ ] Dashboard updates (multi-wallet summary)
- [ ] Receive monitor per wallet
- [ ] Export/reporting per wallet
- [ ] Independent wallet support (separate seeds)
</content>
</invoke>