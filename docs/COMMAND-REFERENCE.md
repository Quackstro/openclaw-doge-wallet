# 🐕 DOGE Wallet — Command Reference

All commands use the `/wallet` namespace for consistency.

---

## 📊 Info Commands

### `/wallet`
Dashboard overview — shows wallet status at a glance.

```
🐕 DOGE Wallet Dashboard
━━━━━━━━━━━━━━━━━━━━━━━━
💰 Balance: 106.15 DOGE (~$10.22)
📊 UTXOs: 7
🔓 Unlocked
📍 D6i8Te…ncat

📤 Sends: 3 today (9.00 DOGE)
📥 Receives: 4 total
⛽ Avg fee: 0.23 DOGE

🔄 Refreshed: Feb 7, 9:30 AM
```

### `/wallet balance`
Detailed balance breakdown.

```
🐕 DOGE Wallet Balance
━━━━━━━━━━━━━━━━━━━━
💰 Confirmed: 106.15 DOGE (~$10.22)
⏳ Pending: +5.00 DOGE (~$0.48)
📊 UTXOs: 7
📤 Daily: 9.00 / 5000.00 DOGE
🔓 Unlocked
📍 D6i8TeepmrGztENxdME84d2x5UVjLWncat
🔄 Refreshed: Feb 7, 9:30 AM

Much balance. Very DOGE. Wow. 🐕
```

### `/wallet address`
Show the current receiving address.

```
🐕 Receiving Address
━━━━━━━━━━━━━━━━━━━━
📍 D84hUKd37sKjmvfweAAs3CRWiZYuP54ygU

Send DOGE here. Much receive. Wow. 🐕
```

### `/wallet utxos`
Show individual unspent transaction outputs.

```
🐕 UTXOs (7)
━━━━━━━━━━━━
✅ db77d049… vout=1  99.18 DOGE (24 conf)
✅ 54f9bb9a… vout=0  10.14 DOGE (792 conf)
✅ 29914ba6… vout=1   2.83 DOGE (1224 conf)
✅ 87f1bbb9… vout=0   1.00 DOGE (2316 conf)
✅ 73991773… vout=0   1.00 DOGE (2591 conf)
✅ 3a355946… vout=0   1.00 DOGE (2850 conf)
✅ 1fdcfa28… vout=0   1.00 DOGE (3559 conf)

Total: 116.15 DOGE | 0 locked
```

### `/wallet history`
Recent sends and receives.

```
🐕 Transaction History
━━━━━━━━━━━━━━━━━━━━━━

➖ 5.00 DOGE → D84hUK…4ygU
  ⛽ 0.23 fee | micro | Feb 7, 9:10 AM
  🔗 5e53bbbfbc20a35b…

➖ 3.00 DOGE → D84hUK…4ygU
  ⛽ 0.23 fee | micro | Feb 7, 9:04 AM
  🔗 3b757048560ce535…

➕ 10.14 DOGE ← D78TRc…fit3
  Feb 6, 9:53 PM
  🔗 54f9bb9add9bfeed…

➖ 1.00 DOGE → D84hUK…4ygU
  ⛽ 0.23 fee | micro | Feb 7, 8:22 AM
  🔗 db77d0493b6a2f2f…
```

---

## 💸 Sending Commands

### `/wallet send <amount> to <address>`
Send DOGE to an address. Supports multiple formats.

**Usage:**
```
/wallet send 50 to DRecipientAddress
/wallet send 50 DOGE to DRecipientAddress
/wallet send DRecipientAddress 50
```

**Success output:**
```
🐕 Sending DOGE…
━━━━━━━━━━━━━━━━
📤 To: DReci…pient
💰 Amount: 50.00 DOGE (~$4.82)
⛽ Fee: 0.23 DOGE
📝 Tier: small

✅ Transaction broadcast!
🔗 TX: a1b2c3d4e5f6...
⏱️ Est. confirm: ~1 min

Much send. Very crypto. Wow. 🐕
```

**Wallet locked:**
```
🐕 🔒 Wallet is locked. Run /wallet unlock <passphrase> first.
```

**Policy denied:**
```
🐕 Send DENIED
━━━━━━━━━━━━━━
❌ Daily limit exceeded (4,950 / 5,000 DOGE)
Tier: large | 500.00 DOGE (~$48.17)
```

**Approval required (large sends):**
```
🐕 Approval Required
━━━━━━━━━━━━━━━━━━━━
📤 To: DReci…pient
💰 Amount: 500.00 DOGE (~$48.17)
📝 Tier: large
🆔 ID: a1b2c3d4…

⏰ Auto-approves in 5 min unless denied.
Use /wallet deny a1b2c3d4 to cancel.
```

### `/wallet approve <id>`
Approve a pending send.

```
🐕 Approved & Sent!
━━━━━━━━━━━━━━━━━━
📤 To: DReci…pient
💰 500.00 DOGE (~$48.17)
⛽ Fee: 0.34 DOGE
🔗 TX: f6e5d4c3b2a1...

✅ Broadcast! Much approve. Wow. 🐕
```

### `/wallet deny <id>`
Deny a pending send.

```
🐕 Send Denied
━━━━━━━━━━━━━━
❌ 500.00 DOGE (~$48.17) → DReci…pient
🆔 a1b2c3d4…

Much deny. Very safe. Wow. 🐕
```

### `/wallet pending`
Show all pending approval requests.

```
🐕 Pending Approvals (1)
━━━━━━━━━━━━━━━━━━━━━━━━
🆔 a1b2c3d4…
📤 500.00 DOGE → DReci…pient
📝 Tier: large
⏰ Auto-approves in 3m 22s

Use /wallet approve a1b2c3d4 or /wallet deny a1b2c3d4.
```

---

## 🧾 Invoice Commands (A2A)

### `/wallet invoice <amount> <description>`
Create an invoice for receiving DOGE payments.

```
🐕 Invoice Created
━━━━━━━━━━━━━━━━━━
🆔 inv-a1b2c3d4
💰 50.00 DOGE
📝 Payment for data analysis
📍 Pay to: D6i8TeepmrGztENxdME84d2x5UVjLWncat
⏰ Expires: Feb 7, 10:30 AM

Include OP_RETURN: inv-a1b2c3d4
```

### `/wallet invoices`
List recent invoices.

```
🐕 Recent Invoices (3)
━━━━━━━━━━━━━━━━━━━━━━
✅ inv-a1b2… | 50.00 DOGE | Paid
⏳ inv-c3d4… | 25.00 DOGE | Pending
❌ inv-e5f6… | 10.00 DOGE | Expired
```

---

## 🔐 Security Commands

### `/wallet init <passphrase>`
Create a new wallet. The passphrase encrypts your private key.

```
🐕 Wallet Created!
━━━━━━━━━━━━━━━━━━
✅ Keystore encrypted with AES-256-GCM
📍 Address: D6i8TeepmrGztENxdME84d2x5UVjLWncat

⚠️ Recovery phrase sent via secure DM.
   Write it down. It will NOT be shown again.

Much wallet. Very secure. Wow. 🐕
```

### `/wallet recover <mnemonic> | <passphrase>`
Restore a wallet from a 24-word recovery phrase.

```
🐕 Wallet Recovered!
━━━━━━━━━━━━━━━━━━━━
✅ Restored from mnemonic
📍 Address: D6i8TeepmrGztENxdME84d2x5UVjLWncat
🔓 Unlocked and ready

⚠️ Your message has been deleted for security.
```

### `/wallet unlock <passphrase>`
Unlock the wallet for sending.

```
🐕 🔓 Wallet unlocked!
Auto-locks after 10 minutes of inactivity.
```

### `/wallet lock`
Lock the wallet immediately.

```
🐕 🔒 Wallet locked. Much safe. Wow.
```

### `/wallet freeze`
Emergency freeze — blocks all outgoing transactions.

```
🐕 🧊 WALLET FROZEN
━━━━━━━━━━━━━━━━━━
All sends blocked until unfrozen.
Use /wallet unfreeze to resume.
```

### `/wallet unfreeze`
Resume normal operations.

```
🐕 ✅ Wallet unfrozen. Sends enabled.
```

### `/wallet export [N]`
Export the last N audit trail entries (default: 20).

```
🐕 Audit Trail (last 5)
━━━━━━━━━━━━━━━━━━━━━━━
1. send    | 5.00 DOGE → D84hUK… | Feb 7, 9:10 AM
2. send    | 3.00 DOGE → D84hUK… | Feb 7, 9:04 AM
3. receive | 10.14 DOGE ← D78TRc… | Feb 6, 9:53 PM
4. send    | 1.00 DOGE → D84hUK… | Feb 7, 8:22 AM
5. unlock  | Wallet unlocked      | Feb 7, 8:20 AM
```

---

## `/wallet help`
Show all available commands.

```
🐕 DOGE Wallet Commands
━━━━━━━━━━━━━━━━━━━━━━━

📊 Info:
  /wallet — Dashboard overview
  /wallet balance — Check wallet balance
  /wallet address — Show receiving address
  /wallet utxos — UTXO details
  /wallet history — Recent transactions
  /wallet export [N] — Export audit trail (last N entries)

💸 Sending:
  /wallet send <amount> to <address> — Send DOGE
  /wallet approve <id> — Approve pending send
  /wallet deny <id> — Deny pending send
  /wallet pending — Show pending approvals

🧾 Invoices (A2A):
  /wallet invoice <amount> <description> — Create invoice
  /wallet invoices — List recent invoices

🔐 Security:
  /wallet init <passphrase> — Create new wallet
  /wallet recover <mnemonic> | <passphrase> — Restore
  /wallet unlock <passphrase> — Unlock wallet
  /wallet lock — Lock wallet
  /wallet freeze — Emergency freeze all sends
  /wallet unfreeze — Resume sends

Much command. Very help. Wow. 🐕
```
