# DOGE Wallet Onboarding — Test Flow

This document shows the expected message sequence during wallet onboarding.

## Prerequisites

- No existing wallet (`~/.openclaw/doge/keys/wallet.json` should not exist)
- Plugin loaded and running

## Test Flow

### 1. Trigger Onboarding

**User Input:** `/wallet`

**Expected Response:**
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

### 2. Optional: Learn More

**User Input:** Click [❓ Learn More]

**Expected Response:**
```
🐕 Welcome to DOGE Wallet!

I can help you send and receive Dogecoin right from this chat.

━━━━━━━━━━━━━━━━━━━━
📚 How It Works:

DOGE Wallet is a self-custodial wallet — you own your keys.

• I never see your recovery phrase after setup
• Encrypted with a passphrase only you know
• Works on Dogecoin mainnet (real money!)

🔐 Security: Your funds are as safe as your passphrase + recovery phrase.

⚠️ Note: Telegram bot messages are NOT end-to-end encrypted. 
For large amounts, consider a hardware wallet.

━━━━━━━━━━━━━━━━━━━━

Ready to set up your wallet?

[🚀 Let's Go]
```

### 3. Start Setup

**User Input:** Click [🚀 Let's Go]

**Expected Response:**
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

### 4a. Enter Weak Passphrase

**User Input:** `short123`

**Expected:**
- User's message deleted immediately
- Warning response with options:

```
✅ Passphrase received (your message was deleted).

⚠️ Passphrase Strength Warning

Your passphrase has some issues:
• Too short — need at least 12 characters (you have 8)
• Uses a predictable pattern — try mixing it up

💡 Tip: Use 3-4 random words with numbers, like:
   purple-tiger-42-jumping

This wallet holds real money — a strong passphrase is important!

[🔄 Try Again]  [⚡ Use Anyway]
```

### 4b. Enter Strong Passphrase

**User Input:** `correct-horse-battery-staple-42`

**Expected:**
- User's message deleted immediately
- Proceed to recovery phrase display:

```
✅ Passphrase secured!

📝 Step 2 of 4: Your Recovery Phrase

These 24 words can restore your wallet if anything goes wrong.

⚠️ CRITICAL — Write these down NOW on paper:

```
 1. witch      7. abandon   13. fossil   19. mixed
 2. collapse   8. grocery   14. verify   20. toast
 3. practice   9. artwork   15. curtain  21. wealth
 4. fiber     10. measure   16. eternal  22. orient
 5. revenge   11. hospital  17. bundle   23. purpose
 6. license   12. century   18. account  24. identify
```

🚨 This is shown ONCE. Never share it. Never screenshot it.

[✅ I've Written It Down]
```

### 5. Confirm Backup

**User Input:** Click [✅ I've Written It Down]

**Expected Response:**
```
🔍 Step 3 of 4: Let's Verify

To make sure you saved it correctly, please type these words:

Word #3: ___
Word #11: ___
Word #18: ___

📝 Type all three words separated by spaces:
```

### 6a. Verification Fails

**User Input:** `wrong words here`

**Expected Response:**
```
❌ Verification Failed

That doesn't match. Please check your written copy.

Mismatches:
• Word #3: expected "practice", got "wrong"
• Word #11: expected "hospital", got "words"
• Word #18: expected "account", got "here"

Let's try again — double-check your backup.

[🔄 Show Phrase Again]  [✏️ Try Again]
```

### 6b. Verification Succeeds

**User Input:** `practice hospital account`

**Expected Response:**
```
✅ Perfect! Your recovery phrase is verified.

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

### 7a. Use Recommended Limits

**User Input:** Click [👍 Use Recommended (10 DOGE)]

**Expected:** Skip to step 8.

### 7b. Customize Limits

**User Input:** Click [🔧 Customize]

**Expected Response:**
```
⚙️ Custom Spending Limit

Set your auto-approve limit (transactions below this go through automatically):

[1 DOGE]  [5 DOGE]  [10 DOGE]
[25 DOGE]  [🚫 None (always ask)]
```

**User Input:** Click desired limit (e.g., [5 DOGE])

### 8. Completion

**Expected Response:**
```
⚙️ Spending limit set: Auto-approve up to 10 DOGE

🎉 Your DOGE Wallet is Ready!

📬 Your receiving address:
`DReci...xR9Ke`

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

## Edge Cases

### Session Expiry

If user abandons mid-flow and returns after 1 hour:

**User Input:** `/wallet`

**Expected Response:**
```
👋 Looks like you started setting up but didn't finish.

Would you like to continue where you left off?

[▶️ Resume Setup]  [🔄 Start Over]
```

### Already Initialized

If wallet already exists:

**User Input:** `/wallet`

**Expected:** Normal dashboard display, not onboarding.

## Files Created

- `src/onboarding/index.ts` - Barrel export
- `src/onboarding/types.ts` - Type definitions
- `src/onboarding/state.ts` - State machine & persistence
- `src/onboarding/flow.ts` - Flow handler
- `src/onboarding/passphrase-validator.ts` - Passphrase strength validation
- `src/onboarding/message-utils.ts` - Message formatting & utilities

## Files Modified

- `index.ts` - Added onboarding integration
