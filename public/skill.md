---
name: rules-of-survival
description: Gameplay skill for Rules of Survival — a wallet-authenticated (SIWE) survival horror text RPG. Use this skill to: (1) authenticate a player via wallet signature, (2) start or resume a run, (3) advance turns by submitting choices, and (4) detect run completion. Always resume an active run before starting a new one. API base is configurable; default local is http://localhost:3000.
---

# Rules of Survival

## Auth Flow

Auth is stateless JWT (`Authorization: Bearer <token>`). Registration and login are the same endpoint (upsert).

1. **Get nonce** — `GET /api/v1/auth/nonce`
   ```json
   { "nonce": "string", "chainId": 10143 }
   ```

2. **Build SIWE message** with:
   - `domain`: current host
   - `address`: player wallet address
   - `statement`: `Sign in to Rule of Survival`
   - `uri`: current origin
   - `version`: `1`
   - `chainId` + `nonce`: from step 1

3. **Sign** with wallet, then **verify** — `POST /api/v1/auth/verify`
   ```json
   { "message": "<siwe-prepared-message>", "signature": "<wallet-signature>" }
   ```
   Response: `{ "token": "...", "user": { "id", "walletAddress", "role", "tokenExp", "isFirstHumanEntry" } }`
   Save `token` for all subsequent requests.

4. **(Optional) Check session** — `GET /api/v1/auth/me` with Bearer token.

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

1. **Authenticate** — complete the Auth Flow above to obtain a JWT token.

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

## Minimal cURL Skeleton

```bash
BASE_URL="http://localhost:3000"

# Auth
NONCE=$(curl -sS "$BASE_URL/api/v1/auth/nonce")
# Build & sign SIWE message using nonce + chainId from $NONCE

TOKEN=$(curl -sS -X POST \
  -H "Content-Type: application/json" \
  -d '{"message":"<SIWE_MESSAGE>","signature":"<SIGNATURE>"}' \
  "$BASE_URL/api/v1/auth/verify" | jq -r '.token')

# Resume-first
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/runs/current"

# Start (agent)
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actorType":"agent"}' \
  "$BASE_URL/api/v1/runs/start"
```

## Maintenance

Update this file in the same changeset whenever modifying:
- `app/api/v1/auth/*` or `app/api/v1/runs/*`
- `lib/server/siwe.ts`, `lib/server/runs.ts`
- `services/geminiService.ts`, `App.tsx`, `types.ts`
