# DOGE Wallet Mainnet Deployment Checklist

Use this checklist before deploying the DOGE Wallet to mainnet with real funds.

## 📋 Pre-Launch Checklist

### 1. Testnet Validation ✓

- [ ] Wallet init/recover works correctly
- [ ] Lock/unlock functions properly
- [ ] Balance display is accurate
- [ ] Send transactions complete successfully
- [ ] Receive monitoring detects incoming transactions
- [ ] Invoice creation and payment verification works
- [ ] Policy tiers evaluated correctly
- [ ] Approval flow works (approve/deny commands)
- [ ] Freeze/unfreeze functions properly
- [ ] All notifications are delivered
- [ ] Error handling doesn't leak sensitive info

### 2. Security Review ✓

- [ ] Read `docs/SECURITY.md` thoroughly
- [ ] Mnemonic is backed up securely (offline, paper)
- [ ] Passphrase is strong (12+ characters)
- [ ] File permissions are correct:
  ```bash
  ls -la ~/.openclaw/doge/keys/
  # Should show: -rw------- (0600)
  ```
- [ ] No secrets in config files (use env vars)
- [ ] Rate limiting is enabled
- [ ] Input sanitization tested

### 3. Configuration ✓

Update your configuration for mainnet:

```yaml
# openclaw.yaml or plugin config
doge-wallet:
  network: mainnet  # IMPORTANT: Change from testnet
  dataDir: ~/.openclaw/doge
  
  api:
    primary: blockcypher
    fallback: sochain
    blockcypher:
      baseUrl: https://api.blockcypher.com/v1/doge/main
      apiToken: ${BLOCKCYPHER_API_TOKEN}  # Use env var
  
  policy:
    enabled: true  # MUST be enabled for mainnet
    tiers:
      micro:  { maxAmount: 1,    approval: "auto-logged" }
      small:  { maxAmount: 10,   approval: "auto-logged" }
      medium: { maxAmount: 100,  approval: "notify-delay", delayMinutes: 5 }
      large:  { maxAmount: 1000, approval: "owner-required" }
      sweep:  { maxAmount: null, approval: "owner-confirm-code" }
    limits:
      dailyMax: 1000        # Adjust for your needs
      hourlyMax: 200
      txCountDailyMax: 50
      cooldownSeconds: 30   # Minimum 10s recommended
  
  utxo:
    minConfirmations: 6     # IMPORTANT: 6 for mainnet (vs 1 for testnet)
    dustThreshold: 1000000  # 0.01 DOGE
    refreshIntervalSeconds: 60
  
  fees:
    strategy: medium        # Not 'low' for mainnet
    maxFeePerKb: 500000000  # 5 DOGE/KB cap
    fallbackFeePerKb: 100000000
  
  notifications:
    enabled: true
    channel: telegram
    target: "YOUR_CHAT_ID"
    lowBalanceAlert: 100    # Notify when below 100 DOGE
```

### 4. Configuration Validation ✓

- [ ] `network` is set to `mainnet`
- [ ] `policy.enabled` is `true`
- [ ] `utxo.minConfirmations` is at least 6
- [ ] `policy.limits.dailyMax` is reasonable for your use case
- [ ] `policy.limits.cooldownSeconds` is at least 10
- [ ] `fees.strategy` is "medium" or "high" (not "low")
- [ ] `notifications.enabled` is `true`
- [ ] Warning: Daily limit > 1000 DOGE triggers a warning

### 5. Environment Variables ✓

```bash
# Set these BEFORE starting the wallet
export BLOCKCYPHER_API_TOKEN="your-api-token"
export SOCHAIN_API_KEY="your-api-key"  # Optional
```

- [ ] API tokens are set via environment variables
- [ ] Tokens are not committed to version control
- [ ] Production tokens are different from testnet

### 6. Wallet Initialization ✓

```bash
# First time setup
/wallet init <strong-passphrase>

# CRITICAL: Backup the mnemonic NOW
# Write it down physically, store securely

# Verify address format (mainnet starts with 'D')
/wallet address
```

- [ ] Wallet initialized with strong passphrase
- [ ] Address starts with 'D' (mainnet format)
- [ ] Mnemonic is written down and stored securely
- [ ] Mnemonic is NOT stored digitally

### 7. Small Test Transaction ✓

Before going live:

1. Send a small amount (1-5 DOGE) to the wallet
2. Verify it appears in balance
3. Send a small amount (1 DOGE) out
4. Verify transaction completes
5. Verify notifications work

```bash
# Check balance after receiving
/balance

# Small test send
/send 1 DOGE to D...TestAddress

# Verify in history
/wallet history
```

- [ ] Test deposit received
- [ ] Test withdrawal completed
- [ ] Notifications received
- [ ] History shows transactions

## 🔍 Monitoring Setup

### Transaction Monitoring

- [ ] Set up alerts for transactions > threshold
- [ ] Monitor daily spending vs limits
- [ ] Set up low balance alerts
- [ ] Monitor for failed transactions

### System Monitoring

- [ ] Monitor wallet process uptime
- [ ] Set up disk space alerts (for logs/cache)
- [ ] Monitor API rate limit usage
- [ ] Set up log aggregation if needed

### Recommended Tools

1. **Notifications**: Telegram (built-in), or add custom webhook
2. **Balance Tracking**: Use `/balance` command or external monitor
3. **Block Explorer**: [DogeChain](https://dogechain.info) for manual verification

## 🚀 Go-Live Procedure

1. **Final Configuration Check**
   ```bash
   # Run preflight checks (if using TypeScript directly)
   npx tsx -e "import { runMainnetPreflightChecks } from './src/mainnet-config.js'; ..."
   ```

2. **Start Fresh**
   - Restart OpenClaw to pick up new config
   - Verify wallet is locked on startup

3. **Unlock When Ready**
   ```bash
   /wallet unlock <passphrase>
   ```

4. **Monitor First Hour Closely**
   - Watch for any errors
   - Verify transactions complete
   - Check notifications work

5. **Document**
   - Record the wallet address
   - Note deployment date/time
   - Document any custom configuration

## 📊 Recommended Limits by Use Case

### Micro-payments (Tips, Small Rewards)
```yaml
limits:
  dailyMax: 100
  hourlyMax: 25
  txCountDailyMax: 100
```

### Medium Operations (Service Payments)
```yaml
limits:
  dailyMax: 1000
  hourlyMax: 200
  txCountDailyMax: 50
```

### High-Volume (Active Trading)
```yaml
limits:
  dailyMax: 10000
  hourlyMax: 2000
  txCountDailyMax: 200
```

⚠️ **Warning**: Higher limits = higher risk. Start conservative.

## ⚠️ Important Warnings

### DO NOT:
- ❌ Store more than you can afford to lose
- ❌ Use the same wallet for mainnet and testnet
- ❌ Share your mnemonic or passphrase
- ❌ Disable spending policy on mainnet
- ❌ Set minConfirmations below 6 for mainnet
- ❌ Use auto-approval for large amounts
- ❌ Ignore security warnings

### DO:
- ✅ Start with small amounts
- ✅ Test thoroughly on testnet first
- ✅ Keep conservative limits
- ✅ Monitor actively after launch
- ✅ Have an incident response plan
- ✅ Keep your mnemonic backup secure
- ✅ Regularly review the audit log

## 🆘 Emergency Procedures

### Immediate Freeze
```bash
/wallet freeze
```

### Export Audit Log
```bash
/wallet export 500
```

### Check for Unauthorized Activity
```bash
/wallet history
```

### Contact
- [Dogecoin Community](https://dogecoin.com)
- [OpenClaw Support](https://openclaw.dev)

---

## ✅ Final Sign-Off

Before enabling mainnet:

```
Date: _______________
Operator: _______________

I confirm that:
- [ ] I have read and understood SECURITY.md
- [ ] I have completed all items in this checklist
- [ ] I have backed up the mnemonic securely
- [ ] I understand the risks of operating a mainnet wallet
- [ ] I have tested the recovery procedure

Signature: _______________
```

---

Much preparation. Very ready. Wow. 🐕
