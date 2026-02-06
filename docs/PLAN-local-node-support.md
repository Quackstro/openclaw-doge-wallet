# DOGE Wallet Plugin — Local Node Support Plan

**Date:** 2026-02-05  
**Status:** 📋 Planning  
**Priority:** Enhancement (optional feature)

---

## Overview

Add support for connecting to a local Dogecoin Core node (pruned or full) as an alternative to third-party API providers. Users who prioritize privacy, reliability, or want to avoid rate limits can run their own node.

---

## Motivation

| Concern | API-Only | Local Node |
|---------|----------|------------|
| Rate limits | Yes (BlockCypher: 200/hr free) | None |
| Privacy | APIs see all addresses queried | Full privacy |
| Reliability | Dependent on 3rd party uptime | Self-controlled |
| Cost | Free tiers have limits | VPS resources only |
| Latency | Network round-trip | Local RPC (~1ms) |
| Disk space | 0 GB | 5 GB (pruned) / 70+ GB (full) |

---

## Configuration Schema

### New Config Options

```json
{
  "api": {
    "primary": "local-node",        // NEW option
    "fallback": "blockcypher",
    
    "localNode": {                   // NEW section
      "enabled": false,
      "rpcHost": "127.0.0.1",
      "rpcPort": 22555,              // Mainnet default
      "rpcUser": "dogecoin",
      "rpcPassword": "",             // Required if enabled
      "rpcTimeout": 30000,           // ms
      "walletName": null,            // For multi-wallet setups
      "useSsl": false,
      "network": "mainnet"           // mainnet | testnet
    }
  }
}
```

### Testnet Config

```json
{
  "localNode": {
    "rpcPort": 44555,               // Testnet default
    "network": "testnet"
  }
}
```

---

## Implementation Phases

### Phase 1: RPC Client (2-3 hours)

**New file:** `src/api/local-node.ts`

```typescript
interface LocalNodeProvider extends DogeApiProvider {
  // Core RPC methods needed:
  getBalance(): Promise<number>;
  listUnspent(minConf?: number): Promise<UTXO[]>;
  getRawTransaction(txid: string): Promise<RawTransaction>;
  sendRawTransaction(hex: string): Promise<string>;
  estimateSmartFee(blocks: number): Promise<FeeEstimate>;
  getBlockchainInfo(): Promise<BlockchainInfo>;
  
  // Health check
  ping(): Promise<boolean>;
}
```

**RPC Implementation:**
- Use native `http`/`https` module (no new deps)
- JSON-RPC 1.0 protocol (Dogecoin Core standard)
- Basic auth header: `Authorization: Basic base64(user:pass)`
- Connection pooling with keep-alive
- Timeout handling

### Phase 2: UTXO Adapter (1-2 hours)

**Modify:** `src/utxo/manager.ts`

Map `listunspent` RPC response to existing UTXO interface:

```typescript
// RPC listunspent response
{
  "txid": "abc123...",
  "vout": 0,
  "address": "D...",
  "amount": 100.0,        // DOGE (not koinu)
  "confirmations": 6,
  "spendable": true,
  "solvable": true
}

// Convert to plugin UTXO format
{
  txid: "abc123...",
  vout: 0,
  value: 10000000000,     // koinu
  confirmations: 6,
  script: "76a914..."     // May need getrawtransaction for this
}
```

**Note:** `listunspent` requires wallet functionality. Two approaches:
1. **Watch-only wallet** — Import address with `importaddress` (no private keys on node)
2. **UTXO scan** — Use `scantxoutset` (Dogecoin Core 1.14.6+, no wallet needed)

Recommend: `scantxoutset` for privacy (node never sees our addresses persistently).

### Phase 3: Transaction Broadcast (1 hour)

**Modify:** `src/tx/broadcaster.ts`

Add local node to broadcast chain:

```typescript
const broadcastOrder = [
  'local-node',    // Try local first if configured
  'p2p',           // Then P2P peers
  'blockcypher',   // Then APIs
  'sochain',
  'blockchair'
];
```

RPC call: `sendrawtransaction <hex>`

### Phase 4: Failover Integration (1 hour)

**Modify:** `src/api/failover.ts`

- Add `local-node` to provider registry
- Health check via `getblockchaininfo` RPC
- Mark unhealthy if:
  - Connection refused
  - RPC timeout
  - Node syncing (`initialblockdownload: true`)
  - Stale chain (last block > 1 hour old)

### Phase 5: Fee Estimation (30 min)

**Modify:** `src/fees.ts`

Use `estimatesmartfee` RPC when local node available:

```typescript
// RPC call
{ "method": "estimatesmartfee", "params": [6] }

// Response
{ "feerate": 0.001, "blocks": 6 }  // DOGE/kB
```

Convert to koinu/byte for consistency with existing fee logic.

### Phase 6: Documentation (1 hour)

**Update:** `README.md`

Add new section:

```markdown
## Local Node Setup (Optional)

### Pruned Node (~5 GB)

1. Install Dogecoin Core:
   ```bash
   # Ubuntu/Debian
   sudo add-apt-repository ppa:dogecoin/dogecoin
   sudo apt update && sudo apt install dogecoind
   ```

2. Configure `~/.dogecoin/dogecoin.conf`:
   ```ini
   server=1
   rpcuser=dogecoin
   rpcpassword=YOUR_SECURE_PASSWORD
   rpcallowip=127.0.0.1
   prune=5000          # Keep 5 GB of blocks
   txindex=0           # Not needed for pruned
   ```

3. Start and sync:
   ```bash
   dogecoind -daemon
   dogecoin-cli getblockchaininfo  # Check sync progress
   ```

4. Configure the plugin:
   ```json
   {
     "api": {
       "primary": "local-node",
       "localNode": {
         "enabled": true,
         "rpcUser": "dogecoin",
         "rpcPassword": "YOUR_SECURE_PASSWORD"
       }
     }
   }
   ```

### Full Node (~70+ GB)

Same as above, but omit `prune=5000` from config.

### Systemd Service (recommended)

```ini
[Unit]
Description=Dogecoin Core
After=network.target

[Service]
User=dogecoin
ExecStart=/usr/bin/dogecoind -daemon=0 -conf=/home/dogecoin/.dogecoin/dogecoin.conf
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
```

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `src/api/local-node.ts` | RPC client implementation |
| `src/api/local-node.test.ts` | Unit tests with mocked RPC |
| `docs/local-node-setup.md` | Detailed setup guide |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add `LocalNodeConfig` interface |
| `src/config.ts` | Add local node config defaults + validation |
| `src/api/failover.ts` | Register local-node provider |
| `src/utxo/manager.ts` | Add RPC-based UTXO fetching |
| `src/tx/broadcaster.ts` | Add local node to broadcast chain |
| `src/fees.ts` | Add RPC fee estimation |
| `openclaw.plugin.json` | Add localNode config schema |
| `README.md` | Add setup documentation |

---

## Estimated Effort

| Phase | Time | Complexity |
|-------|------|------------|
| Phase 1: RPC Client | 2-3 hrs | Medium |
| Phase 2: UTXO Adapter | 1-2 hrs | Medium |
| Phase 3: TX Broadcast | 1 hr | Low |
| Phase 4: Failover | 1 hr | Low |
| Phase 5: Fee Estimation | 30 min | Low |
| Phase 6: Documentation | 1 hr | Low |
| **Total** | **6-8 hrs** | — |

---

## Testing Strategy

### Unit Tests
- Mock RPC responses for all methods
- Test error handling (timeout, auth failure, node syncing)
- Test UTXO format conversion

### Integration Tests
- Spin up regtest node in Docker
- Full send cycle: create → sign → broadcast → confirm
- Failover: kill node mid-request, verify API fallback

### Manual Testing
- Sync pruned node on testnet (~30 min)
- Full wallet flow with local node as primary

---

## Security Considerations

1. **RPC Password** — Must use `uiHints.secret: true` in config schema
2. **Network Binding** — Document `rpcallowip=127.0.0.1` only
3. **No Wallet Import** — Use `scantxoutset` to avoid storing addresses on node
4. **SSL Option** — Support `useSsl: true` for remote nodes (not recommended)

---

## Future Enhancements (v2)

- **Electrum server support** — ElectrumX/Fulcrum for lighter alternative
- **Docker compose template** — One-click node + plugin setup
- **Auto-detection** — Probe localhost:22555 on startup
- **Block notifications** — ZMQ subscription for instant tx detection

---

## Decision Log

| Question | Decision | Rationale |
|----------|----------|-----------|
| Watch-only vs scantxoutset? | `scantxoutset` | Better privacy, no persistent address storage |
| New dependency for RPC? | No, use native http | Keep deps minimal |
| Support remote nodes? | Yes, with SSL option | Some users run nodes on separate machines |
| Default enabled? | No | Opt-in feature, most users prefer API simplicity |

---

## Approval

- [ ] Dr. Castro review
- [ ] Implementation approved
- [ ] Ready for development

