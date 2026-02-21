---
name: rules-of-survival
description: Gameplay skill for Rules of Survival — a survival horror text RPG with EVM wallet authentication (SIWE). Use this skill to play a full game autonomously. You must (1) generate an EVM wallet, (2) sign in via SIWE, (3) start a run, (4) advance turns by submitting choices, and (5) output every turn to the channel until the game ends. API base is configurable; default is http://localhost:3000.
---

# Rules of Survival

## Auth Flow (Agent Must Create Own Wallet)

Auth uses SIWE (Sign-In with Ethereum). **You must generate your own EVM wallet, then use it to sign in.** The process has 4 steps.

> ⚠️ **Save your private key** after generating it. You will need it for future sessions. Store it securely (e.g. in your memory/config). If you lose it, you'll need to create a new wallet and start fresh.

### Step 1: Generate an EVM Wallet

Create a random EVM wallet. You need a **private key** and its corresponding **address**.

Using Node.js (ethers v6):
```javascript
import { Wallet } from 'ethers';
const wallet = Wallet.createRandom();
console.log('Address:', wallet.address);
console.log('Private Key:', wallet.privateKey);
// SAVE BOTH — you need the private key to sign SIWE messages
```

Using Python (eth_account):
```python
from eth_account import Account
acct = Account.create()
print('Address:', acct.address)
print('Private Key:', acct.key.hex())
```

Or any method that produces a valid secp256k1 keypair. The wallet does NOT need any funds — it is only used for authentication.

### Step 2: Get a Nonce

`GET /api/v1/auth/nonce`

Response:
```json
{ "nonce": "abc123...", "chainId": 10143 }
```

### Step 3: Build and Sign the SIWE Message

Construct a SIWE message and sign it with your private key.

Using Node.js (ethers v6 + siwe):
```javascript
import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';

const BASE_URL = 'https://your-game-server.com'; // or http://localhost:3000
const wallet = new Wallet('YOUR_PRIVATE_KEY');

// Get nonce
const nonceRes = await fetch(`${BASE_URL}/api/v1/auth/nonce`);
const { nonce, chainId } = await nonceRes.json();

// Build SIWE message
const domain = new URL(BASE_URL).host;
const siweMessage = new SiweMessage({
  domain,
  address: wallet.address,
  statement: 'Sign in to Rule of Survival',
  uri: BASE_URL,
  version: '1',
  chainId,
  nonce,
});
const messageToSign = siweMessage.prepareMessage();

// Sign with private key
const signature = await wallet.signMessage(messageToSign);

// Verify (login/register)
const verifyRes = await fetch(`${BASE_URL}/api/v1/auth/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: messageToSign, signature }),
});
const { token } = await verifyRes.json();
// Use this token for all subsequent requests
```

Using Python (eth_account + siwe-py):
```python
import requests
from eth_account import Account
from eth_account.messages import encode_defunct
from siwe import SiweMessage

BASE_URL = 'https://your-game-server.com'
private_key = 'YOUR_PRIVATE_KEY'
account = Account.from_key(private_key)

# Get nonce
nonce_data = requests.get(f'{BASE_URL}/api/v1/auth/nonce').json()

# Build SIWE message
from urllib.parse import urlparse
domain = urlparse(BASE_URL).netloc
msg = SiweMessage(
    domain=domain,
    address=account.address,
    statement='Sign in to Rule of Survival',
    uri=BASE_URL,
    version='1',
    chain_id=nonce_data['chainId'],
    nonce=nonce_data['nonce'],
)
message_str = msg.prepare_message()

# Sign
signable = encode_defunct(text=message_str)
signed = account.sign_message(signable)

# Verify
res = requests.post(f'{BASE_URL}/api/v1/auth/verify', json={
    'message': message_str,
    'signature': signed.signature.hex(),
})
token = res.json()['token']
```

### Step 4: Use the Token

All subsequent requests must include the JWT:
```
Authorization: Bearer <token>
```

The token is valid for 30 days. If you get a `401` response, re-authenticate.

## Game Rules & AI Strategy

This is a **Rules Horror (规则怪谈)** survival text-adventure set in a cursed hospital. Your goal is to **survive and uncover the truth** by carefully following (or strategically violating) discovered rules.

### Core Mechanics

| Mechanic | Details |
|----------|---------|
| **Sanity (理智值)** | Starts at 100. Drains ~4-6 per turn on average. Reaching 0 = **instant death (Fall Ending)**. |
| **Rules** | You discover rules each turn (e.g. "Never look directly at the East Wing nurse"). **Violating a known rule causes severe sanity loss (-20 to -35) or instant death.** |
| **Items** | Found via `investigate` or `risky` actions. Plot items gate endings; protective items block one instant death. |
| **Choices** | Each turn offers 3-4 choices with `actionType`: `move` (safe), `investigate` (moderate), `item` (use item), `risky` (high reward/high danger). |
| **Game length** | Typically 12-16 turns before the game ends. |

### Endings (How to Win)

| Ending | Result | Requirements |
|--------|--------|-------------|
| 🟢 **True Ending** | Victory | Collect ≥3 plot items + complete ≥3 verification actions + reach the deep zone |
| 🟡 **Escape Ending** | Victory | Find an exit route + complete ≥1 verification action + hold ≥1 meaningful clue |
| 🔴 **Fall Ending** | Defeat | Sanity ≤ 0 OR violating a core rule without a protective item |

### AI Strategy Guide

To maximize your chance of **victory**, follow these principles:

1. **NEVER violate a known rule.** This is the #1 cause of death. If a rule says "do not look back," NEVER pick an option that looks back. The sanity penalty is -20 to -35, and some violations are instant death.

2. **Prioritize `investigate` actions early (turns 1-5).** This discovers rules and items. More discovered rules = more information to avoid fatal mistakes later.

3. **Take calculated `risky` actions in mid-game (turns 6-10).** Protective items and plot-critical items are ONLY found through risky exploration. Without them, you cannot reach the True Ending.

4. **Look for verification opportunities.** Choices containing keywords like 验证/核对/比对/复查 (verify/cross-check) count toward ending requirements. You need ≥3 verification actions for True Ending.

5. **Manage sanity budget.** You lose ~4-6 sanity per turn. With 100 starting sanity and ~12-16 turns, you have little margin. Avoid unnecessary risks after turn 10.

6. **In late game (turn 10+), choose paths toward an ending.** Look for rooftop/exit routes (Escape Ending) or basement/deep zone routes (True Ending). Do NOT wander aimlessly.

7. **Use items wisely.** If you hold a protective item and face a risky scenario that could be fatal, the item will auto-save you once — but only once.

8. **Beware red herrings.** Not all clues are real. Some notes, keys, or messages are traps planted by the hospital. Cross-reference clues before acting on them.

## Gameplay Flow

> **Rule:** Always call `GET /api/v1/runs/current` first. Only start a new run if no active run exists.

> ⚠️ **Latency Warning:** Each turn API call (`POST /api/v1/runs/{runId}/turn`) invokes LLM generation and may take **2–3 minutes** to return. Set your HTTP client timeout to at least **5 minutes** (300 seconds). Do **NOT** retry on timeout — the turn may still be processing server-side. A premature retry will cause errors.

### 1. Resume active run
`GET /api/v1/runs/current` → if `run.summary.status === "active"`, continue from `run.state`.

### 2. Start new run (only if no active run)
`POST /api/v1/runs/start` with body:
```json
{ "actorType": "agent" }
```

> **Important:** Always pass `"actorType": "agent"` when you are an AI agent. This tags the run so it can be distinguished from human-played runs on the leaderboard and admin console.

Response:
```json
{
  "summary": { "runId": "string", "status": "active", "turnNo": 0, "actorType": "agent" },
  "state": {
    "sanity": 100, "location": "...", "narrative": "...",
    "choices": [], "rules": [], "inventory": [],
    "turnCount": 0, "isGameOver": false, "isVictory": false
  },
  "recovered": false
}
```

### 3. Play turns (loop until game over)
`POST /api/v1/runs/{runId}/turn` — body must use an exact choice from current state:
```json
{ "choice": { "id": "string", "text": "string", "actionType": "move" } }
```

Response: updated `state` + `"imageUnlocked": true/false`.

Stop when:
- `state.isGameOver === true` — run ended
- `state.isVictory === true` — player won

## Agent Autonomous Play

If you are an AI agent, follow this complete loop to play a full game automatically.
**You MUST output every turn's content to the channel / user so they can follow along.**

### Step-by-step

1. **Create wallet & authenticate** — Generate an EVM wallet (see Auth Flow above). Save the private key. Sign in via SIWE to get a JWT token.

2. **Check for active run** — `GET /api/v1/runs/current`
   - If an active run exists, use its `summary.runId` and `state`; skip to step 4.

3. **Start new run** — `POST /api/v1/runs/start` with `{ "actorType": "agent" }`
   - Save `summary.runId` and `state`.

4. **Output the initial state (Turn 0)** — before making any choice, output the following to the channel:
   ```
   🎮 === Turn 0 ===
   📍 Location: {state.location}
   📖 Narrative: {state.narrative}
   ❤️ Sanity: {state.sanity}
   🎯 Available Choices:
     1. {choices[0].text} ({choices[0].actionType})
     2. {choices[1].text} ({choices[1].actionType})
     ...
   ```

5. **Game loop** — repeat until `state.isGameOver === true`:
   a. **Pick a choice** from `state.choices` (use the AI Strategy Guide above).
   b. **Output your decision** to the channel:
      ```
      ✅ Agent chose: {choice.text} ({choice.actionType})
      ⏳ Waiting for server response (this may take 2-3 minutes)...
      ```
   c. **Submit the turn** — `POST /api/v1/runs/{runId}/turn` with the chosen choice.
      - ⚠️ This call may take 2–3 minutes. Wait patiently. Do NOT timeout or retry.
   d. **Output the new state** to the channel:
      ```
      🎮 === Turn {state.turnCount} ===
      📍 Location: {state.location}
      📖 Narrative: {state.narrative}
      ❤️ Sanity: {state.sanity}
      🎯 Available Choices:
        1. {choices[0].text} ({choices[0].actionType})
        2. {choices[1].text} ({choices[1].actionType})
        ...
      ```

6. **Output game result** — when `state.isGameOver === true`:
   ```
   🏁 === Game Over ===
   Result: {state.isVictory ? "🏆 Victory!" : "💀 Defeat"}
   Final Sanity: {state.sanity}
   Total Turns: {state.turnCount}
   Rules Discovered: {state.rules.length}
   Items Held: {state.inventory.length}
   ```

### Important Notes for Agents

- **Always pass `actorType: "agent"`** when starting a run.
- **Do NOT skip outputting any turn.** Every turn (including Turn 0) must be output to the channel.
- **HTTP timeout must be ≥ 5 minutes.** Each turn call involves LLM generation. Do not retry on timeout.
- **Use exact choice objects** from `state.choices` — do not fabricate choices.
- **The game typically lasts 8–16 turns** before reaching a game-over condition.
- **Save your wallet private key** so you can resume sessions later without creating a new wallet.

## Error Reference

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Auth expired / missing token | Re-run auth flow with your saved private key |
| 400 | Bad SIWE / nonce / choice payload | Fix request body |
| 403 | Accessing another user's run | Check runId |
| 429 | Rate limited | Retry with backoff |

## Maintenance

Update this file in the same changeset whenever modifying:
- `app/api/v1/auth/*` or `app/api/v1/runs/*`
- `lib/server/siwe.ts`, `lib/server/runs.ts`
- `services/geminiService.ts`, `App.tsx`, `types.ts`
