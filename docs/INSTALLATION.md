# 🐕 DOGE Wallet — Installation & Onboarding Guide

A complete step-by-step guide to installing the DOGE Wallet plugin and setting up your first wallet.

---

## Prerequisites

Before you begin, make sure you have:

- **OpenClaw** installed and running ([docs.openclaw.ai](https://docs.openclaw.ai))
- **Telegram** configured as a channel in OpenClaw
- **Node.js** 20 or later
- Your **Telegram chat ID** (send `/status` to your OpenClaw bot to find it)

---

## Part 1: Install the Plugin

### Option A: Install from npm (recommended)

```bash
openclaw plugins install @quackstro/doge-wallet
```

### Option B: Install from GitHub

```bash
git clone https://github.com/Quackstro/openclaw-doge-wallet.git ~/.openclaw/extensions/doge-wallet
cd ~/.openclaw/extensions/doge-wallet
npm install
npm run build
```

---

## Part 2: Configure the Plugin

Add the plugin configuration to your OpenClaw config file.

### 2.1 — Open your config

```bash
nano ~/.openclaw/openclaw.json
```

### 2.2 — Add the plugin entry

Add the following inside your existing config (merge with what's already there):

```json
{
  "plugins": {
    "entries": {
      "doge-wallet": {
        "enabled": true,
        "config": {
          "network": "mainnet",
          "notifications": {
            "enabled": true,
            "channel": "telegram",
            "target": "YOUR_TELEGRAM_CHAT_ID"
          }
        }
      }
    }
  }
}
```

> ⚠️ Replace `YOUR_TELEGRAM_CHAT_ID` with your actual Telegram chat ID (a number like `123456789`).

### 2.3 — Optional: Add API keys for higher rate limits

If you have API keys, add them to the config:

```json
{
  "plugins": {
    "entries": {
      "doge-wallet": {
        "enabled": true,
        "config": {
          "network": "mainnet",
          "api": {
            "primary": "blockcypher",
            "fallback": "sochain",
            "blockcypher": {
              "apiToken": "YOUR_BLOCKCYPHER_TOKEN"
            },
            "sochain": {
              "apiKey": "YOUR_SOCHAIN_KEY"
            }
          },
          "notifications": {
            "enabled": true,
            "channel": "telegram",
            "target": "YOUR_TELEGRAM_CHAT_ID"
          }
        }
      }
    }
  }
}
```

> 💡 API keys are optional. The plugin works without them using free tiers + P2P broadcasting.  
> Get a free BlockCypher token at [blockcypher.com](https://www.blockcypher.com/) (200 → 2,000 req/hr).

### 2.4 — Restart OpenClaw

```bash
sudo supervisorctl restart openclaw
```

Or however you normally restart your OpenClaw gateway.

---

## Part 3: Wallet Onboarding (Telegram)

Once the plugin is loaded, set up your wallet through Telegram. The entire process takes about 2 minutes.

### Step 1 — Start Onboarding

Send `/wallet` to your OpenClaw bot in Telegram.

You'll see a welcome screen:

```
🐕 Welcome to DOGE Wallet!

I can help you send and receive Dogecoin right from this chat.
Before we start, a few things to know:

• Your keys are encrypted and stored locally
• I'll generate a 24-word recovery phrase — you MUST save it
• You control spending limits for autonomous transactions

Ready to set up your wallet?

[🚀 Let's Go]  [❓ Learn More]
```

Tap **🚀 Let's Go** to begin.

---

### Step 2 — Create Your Passphrase (Step 1 of 4)

The bot will ask you to create a passphrase:

```
🔐 Step 1 of 4: Create Your Passphrase

Your passphrase encrypts your wallet. Choose something strong:
• At least 12 characters
• Mix of letters, numbers, symbols
• NOT a common phrase

⚠️ If you forget this, you'll need your recovery phrase to restore.

📝 Reply with your passphrase:
(I'll delete your message immediately for security)
```

**Type your passphrase** and send it. The bot will immediately delete your message for security.

> 💡 **Tips for a strong passphrase:**
> - Use 3-4 random words with numbers: `purple-tiger-42-jumping`
> - At least 12 characters
> - Don't reuse passwords from other services
> - **Write it down** — you'll need it to unlock the wallet after restarts

If your passphrase is weak, you'll see a warning with the option to try again or proceed anyway.

---

### Step 3 — Save Your Recovery Phrase (Step 2 of 4)

The bot displays your 24-word recovery phrase:

```
📝 Step 2 of 4: Your Recovery Phrase

These 24 words can restore your wallet if anything goes wrong.

⚠️ CRITICAL — Write these down NOW on paper:

   1. word    2. word    3. word
   4. word    5. word    6. word
   ...
  22. word   23. word   24. word

🚨 This is shown ONCE. Never share it. Never screenshot it.

[✅ I've Written It Down]
```

**⚠️ THIS IS THE MOST IMPORTANT STEP:**

1. **Get a pen and paper** right now
2. **Write down all 24 words** in order, exactly as shown
3. **Double-check** each word — one wrong letter means lost funds
4. **Store it somewhere safe** (fireproof safe, safety deposit box)
5. **Never** screenshot it, email it, or save it digitally
6. **Delete the Telegram message** after you've verified your backup

When you've written everything down, tap **✅ I've Written It Down**.

---

### Step 4 — Verify Your Backup (Step 3 of 4)

The bot will quiz you on 3 random words to confirm you saved the phrase:

```
🔍 Step 3 of 4: Let's Verify

To make sure you saved it correctly, please type these words:

Word #5: ___
Word #12: ___
Word #21: ___

📝 Type all three words separated by spaces:
```

**Type the 3 requested words** separated by spaces (e.g., `apple banana cherry`).

- ✅ If correct → proceed to spending limits
- ❌ If wrong → you can view the phrase again or retry (up to 3 attempts per round)

---

### Step 5 — Set Spending Limits (Step 4 of 4)

Choose how much the agent can spend automatically:

```
⚙️ Step 4 of 4: Spending Limits

How much can I spend automatically without asking you?

📊 Recommended for beginners:
• Auto-approve: Up to 10 DOGE (~$1) per transaction
• Notify + wait: 10-100 DOGE
• Always ask: Over 100 DOGE

You can change this later with /wallet settings.

[👍 Use Recommended (10 DOGE)]
[🔧 Customize]
```

**Choose an option:**

| Option | What it means |
|--------|---------------|
| **Recommended (10 DOGE)** | Agent can auto-send up to 10 DOGE. Anything above needs your approval. |
| **Customize** | Pick your own limit: 1, 5, 10, 25 DOGE, or "always ask" (0) |

> 💡 You can always change limits later. Start conservative.

---

### Step 6 — You're Done! 🎉

```
🎉 Your DOGE Wallet is Ready!

📬 Your receiving address:
D6i8Tee...Lncat

Send DOGE to this address to fund your wallet.

━━━━━━━━━━━━━━━━━━━━
📋 Quick commands:
• /balance — Check your balance
• /send <address> <amount> — Send DOGE
• /wallet — Wallet dashboard

💡 Tip: Start with a small test deposit (~10 DOGE)

Much wallet. Very ready. Wow. 🐕

[📊 View Dashboard]
```

Your wallet is live on Dogecoin mainnet. You'll receive Telegram notifications for:
- Incoming deposits
- Outgoing transactions
- Transactions needing approval
- Low balance alerts

---

## Part 4: First Steps After Setup

### Fund your wallet

Send a small test amount of DOGE (5-10 DOGE) to your receiving address. You'll get a Telegram notification when it arrives and confirms.

### Check your balance

Send `/balance` or ask your agent "What's my DOGE balance?"

### Send DOGE

Send `/send D... 1.5` or ask your agent to send DOGE. Transactions under your auto-approve limit go through immediately. Larger ones trigger an approval request.

### View the dashboard

Send `/wallet` to see a full overview of your wallet status, balance, recent transactions, and security status.

### Lock your wallet

Send `/wallet lock` when you're done. This clears the private key from memory. You'll need to `/wallet unlock <passphrase>` before sending again.

---

## Troubleshooting

### "Plugin not found" after install

Make sure you restarted the gateway after installing. Check `openclaw plugins list` to verify it's loaded.

### Wallet locked after restart

This is by design — the private key is only held in memory. Send `/wallet unlock <your-passphrase>` to unlock it.

### "Insufficient funds"

Check `/balance` — you may have unconfirmed DOGE that can't be spent yet. Wait for 1 confirmation (~1 minute on Dogecoin).

### "Broadcast failed"

The plugin tries P2P first, then API providers. If all fail, wait a few minutes (API rate limits recover) and retry. Consider adding a BlockCypher API token to increase your rate limit.

### "Rate limit reached"

The spending policy has daily/hourly caps. Wait for the period to reset, or adjust `policy.limits` in your config.

### Lost your passphrase?

You need your 24-word recovery phrase. Use it to restore via the agent tool or set up a new wallet instance.

### Lost your recovery phrase?

**If the wallet is still accessible:** Transfer all funds to a new wallet immediately, then set up a fresh wallet with a new recovery phrase.

**If the wallet is inaccessible:** The funds cannot be recovered. This is the nature of self-custody.

---

## Security Checklist

After setup, verify these items:

- [ ] Recovery phrase written on paper and stored securely
- [ ] Recovery phrase Telegram message deleted
- [ ] Passphrase memorized or stored in a password manager
- [ ] Spending limits set appropriately
- [ ] Notification target (Telegram chat ID) is correct
- [ ] Small test deposit confirmed successfully
- [ ] Small test send confirmed successfully

---

## Updating the Plugin

```bash
openclaw plugins update doge-wallet
sudo supervisorctl restart openclaw
```

Your wallet data (keys, UTXOs, history) is stored separately in `~/.openclaw/doge/` and is not affected by plugin updates.

---

## Uninstalling

The plugin can be disabled without losing your wallet:

```bash
openclaw plugins disable doge-wallet
sudo supervisorctl restart openclaw
```

Your wallet data remains in `~/.openclaw/doge/`. To fully remove:

```bash
# ⚠️ Make sure you've backed up your recovery phrase first!
rm -rf ~/.openclaw/doge/
openclaw plugins disable doge-wallet
```

---

*Much install. Very guide. Such steps. Wow.* 🐕
