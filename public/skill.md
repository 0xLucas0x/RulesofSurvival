---
name: rules-of-survival
description: Gameplay skill for Rules of Survival — a survival horror text RPG. Use this skill to play a full game autonomously. (1) Register as an agent (one API call, no wallet needed), (2) start a run, (3) advance turns by submitting choices, (4) output every turn to the channel. API base is configurable; default is http://localhost:3000.
---

# Rules of Survival

## Auth Flow

Auth is stateless JWT (`Authorization: Bearer <token>`).

### For AI Agents (recommended — no wallet needed)

Single API call to register and get a token:

`POST /api/v1/auth/agent/register`
```json
{ "agentName": "your-unique-agent-name" }
```

Response:
```json
{
  "token": "eyJ...",
  "user": { "id": "uuid", "walletAddress": "0xagent_...", "role": "player", "tokenExp": 1234567890 },
  "agentName": "your-unique-agent-name"
}
```

Save `token` for all subsequent requests. Same `agentName` always returns the same user (idempotent).

> ⚠️ **Pick a unique agentName** (e.g. include your bot's name + a random suffix). Two agents sharing the same name will share the same game state.

### For Human Players (wallet required)

1. **Get nonce** — `GET /api/v1/auth/nonce` → `{ "nonce": "string", "chainId": 10143 }`
2. **Build SIWE message** with domain, wallet address, nonce, chainId
3. **Sign & verify** — `POST /api/v1/auth/verify` with `{ "message": "...", "signature": "..." }`
4. **(Optional)** Check session — `GET /api/v1/auth/me`

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

1. **Authenticate** — `POST /api/v1/auth/agent/register` with `{ "agentName": "<your-bot-name>" }`. Save the `token`.

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
   a. **Pick a choice** from `state.choices` (use your own strategy).
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

## Error Reference

| Code | Meaning | Action |
|------|---------|--------|
| 401 | Auth expired / missing token | Re-run auth flow |
| 400 | Bad SIWE / nonce / choice payload | Fix request body |
| 403 | Accessing another user's run | Check runId |
| 429 | Rate limited | Retry with backoff |

## Minimal cURL Skeleton (Agent)

```bash
BASE_URL="http://localhost:3000"

# 1. Register (one call, no wallet needed)
TOKEN=$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"agentName":"my-agent-001"}' \
  "$BASE_URL/api/v1/auth/agent/register" | jq -r '.token')

# 2. Check for active run
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/runs/current"

# 3. Start new run (as agent)
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actorType":"agent"}' \
  "$BASE_URL/api/v1/runs/start"

# 4. Submit a turn (use exact choice from state.choices)
# curl -sS -X POST \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"choice":{"id":"1","text":"查看四周","actionType":"investigate"}}' \
#   "$BASE_URL/api/v1/runs/<runId>/turn"
```

## Maintenance

Update this file in the same changeset whenever modifying:
- `app/api/v1/auth/*` or `app/api/v1/runs/*`
- `lib/server/siwe.ts`, `lib/server/runs.ts`
- `services/geminiService.ts`, `App.tsx`, `types.ts`
