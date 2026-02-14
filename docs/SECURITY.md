# DOGE Wallet Security Guide

This document covers security considerations, best practices, and incident response procedures for operating the DOGE Wallet plugin.

## 🔐 Key Management

### Private Key Storage

The wallet uses industry-standard encryption for key storage:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: scrypt (N=2^18, r=8, p=1)
- **Storage Location**: `~/.openclaw/doge/keys/wallet.json`
- **File Permissions**: 0600 (owner read/write only)

### Best Practices

1. **Strong Passphrase**
   - Minimum 8 characters (recommend 12+)
   - Mix of uppercase, lowercase, numbers, symbols
   - Avoid dictionary words or personal information
   - Consider using a password manager to generate and store

2. **Passphrase Security**
   - Never share your passphrase
   - Never include passphrase in logs or messages
   - Don't use the same passphrase for multiple wallets
   - Change passphrase if you suspect compromise

3. **Private Key Handling**
   - Keys are zeroed from memory immediately after signing
   - Keys are never logged or included in error messages
   - Keys remain encrypted at rest; only loaded when unlocked

4. **Lock When Not In Use**
   - Always lock the wallet when not actively sending: `/wallet lock`
   - Configure auto-lock timeout if available
   - Wallet starts in locked state after restart

## 💾 Backup & Recovery

### Mnemonic Backup

Your 24-word mnemonic phrase is the **only way** to recover your wallet. Treat it like cash.

**Do:**
- Write it down on paper (not digitally)
- Store in a secure location (safe, safety deposit box)
- Consider splitting across multiple locations
- Use a metal backup for fire/water resistance

**Don't:**
- Screenshot the mnemonic
- Store in cloud services (iCloud, Google Drive, Dropbox)
- Email it to yourself
- Store on your computer
- Share with anyone

### Recovery Procedure

If you need to recover on a new system:

```bash
/wallet recover <24-word mnemonic> | <new passphrase>
```

The wallet will derive the same address from your mnemonic using the standard BIP44 derivation path: `m/44'/3'/0'/0/0`

### Data Backup

For convenience (not security-critical), you may also backup:

- `~/.openclaw/doge/utxos.json` - UTXO cache (speeds up startup)
- `~/.openclaw/doge/audit.json` - Transaction history
- `~/.openclaw/doge/invoices.json` - A2A invoices

These can be regenerated from the blockchain; they contain no secrets.

## 🗑️ Sensitive Message Auto-Delete

Commands that contain sensitive data (passphrases, mnemonics) are automatically deleted from the Telegram chat after being processed. This prevents secrets from remaining visible in chat history.

**Protected commands:**
- `/wallet init <passphrase>` — contains passphrase
- `/wallet recover <mnemonic> | <passphrase>` — contains mnemonic and passphrase
- `/wallet unlock <passphrase>` — contains passphrase

The deletion happens via the Telegram Bot API immediately after the command is received. If deletion fails (e.g., bot lacks permission), a warning is logged but the command still executes normally.

**Requirements:**
- The Telegram bot token must be configured in `channels.telegram.botToken`
- The bot must have permission to delete messages in the chat

## 🛡️ Security Considerations for Operators

### Network Security

1. **API Keys**
   - Store API keys in environment variables, not config files
   - Use separate keys for testnet and mainnet
   - Rotate keys periodically

2. **Callback URLs (A2A)**
   - Only HTTPS callbacks are accepted
   - Internal/private IPs are blocked (SSRF protection)
   - Validate the origin of payment notifications

3. **Rate Limiting**
   - The wallet enforces rate limits on all operations
   - Monitor for unusual patterns that might indicate abuse
   - Adjust limits based on your use case

### Spending Policy

Configure conservative limits for automated operations:

```yaml
# Recommended mainnet settings
policy:
  enabled: true
  tiers:
    micro:  { maxAmount: 1,    approval: "auto-logged" }
    small:  { maxAmount: 10,   approval: "auto-logged" }
    medium: { maxAmount: 100,  approval: "notify-delay", delayMinutes: 5 }
    large:  { maxAmount: 1000, approval: "owner-required" }
    sweep:  { maxAmount: null, approval: "owner-confirm-code" }
  limits:
    dailyMax: 1000
    hourlyMax: 200
    cooldownSeconds: 30
```

### Freeze Capability

In case of suspected compromise:

```bash
/wallet freeze
```

This immediately blocks all outbound transactions until you investigate and unfreeze.

### Access Control

- The wallet should only be accessible to trusted agents
- Review the plugin's registered tools and commands
- Consider restricting who can issue wallet commands

## 🚨 Incident Response

### If You Suspect Compromise

1. **Immediately Freeze**
   ```bash
   /wallet freeze
   ```

2. **Check Recent Activity**
   ```bash
   /wallet history
   /wallet export 100
   ```

3. **Verify Balance**
   ```bash
   /balance
   ```

4. **If funds are at risk:**
   - Move funds to a new wallet on a clean system
   - Do NOT use the same mnemonic
   - Treat the old wallet as compromised forever

### If Passphrase Is Compromised

1. Immediately move all funds to a new address
2. Generate a new wallet with a new mnemonic
3. Never use the old wallet again

### If Mnemonic Is Compromised

1. **This is critical** — anyone with the mnemonic has full access
2. Immediately transfer all funds to a completely new wallet
3. Generate a new mnemonic on a secure, clean device
4. The old wallet is permanently compromised

### Suspicious Transaction Detected

1. Freeze the wallet
2. Check if the transaction was legitimate:
   - Review audit log for who/what initiated it
   - Check the destination address
   - Verify the amount matches expected behavior
3. If unauthorized:
   - Report to relevant authorities if significant
   - Move remaining funds to new wallet
   - Investigate how access was gained

## 📊 Monitoring & Auditing

### Audit Trail

Every wallet operation is logged:

- Send transactions (amount, recipient, tier, approval status)
- Receive transactions (amount, sender, txid)
- Policy decisions (approved/denied/delayed)
- Freeze/unfreeze events
- Invoice creation and payment

Export with: `/wallet export [count]`

### Recommended Monitoring

1. **Balance Alerts**
   - Configure low balance alerts
   - Monitor for unexpected balance drops

2. **Daily Limit Tracking**
   - Watch daily spending against limits
   - Investigate if approaching limits unexpectedly

3. **Failed Transaction Alerts**
   - Monitor for repeated failures
   - Could indicate attack or misconfiguration

4. **Unusual Activity**
   - Large transactions
   - Many small transactions (dust attacks)
   - Transactions to new addresses

### Log Retention

- Audit logs should be retained for compliance
- Consider backing up to immutable storage
- Default retention: unlimited (file grows over time)

## 🔧 Security Configuration Checklist

- [ ] Strong passphrase set (12+ characters)
- [ ] Mnemonic backed up securely (offline, physical)
- [ ] Spending policy enabled and configured
- [ ] Appropriate tier limits for your use case
- [ ] Daily/hourly limits set conservatively
- [ ] Notifications enabled and working
- [ ] Low balance alerts configured
- [ ] File permissions verified (0600 on key files)
- [ ] API keys stored in environment variables
- [ ] Testnet thoroughly tested before mainnet
- [ ] Recovery procedure tested and documented
- [ ] Incident response plan in place

## 📚 Additional Resources

- [Dogecoin Security Best Practices](https://dogecoin.com)
- [BIP39 Mnemonic Standard](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [BIP44 HD Wallet Derivation](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)

---

Much secure. Very careful. Wow. 🐕
