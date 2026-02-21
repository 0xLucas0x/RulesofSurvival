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

### 1. Resume active run
`GET /api/v1/runs/current` → if `run.summary.status === "active"`, continue from `run.state`.

### 2. Start new run (only if no active run)
`POST /api/v1/runs/start` with `{}` body.

Response:
```json
{
  "summary": { "runId": "string", "status": "active", "turnNo": 0, "actorType": "human" },
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
```

## Maintenance

Update this file in the same changeset whenever modifying:
- `app/api/v1/auth/*` or `app/api/v1/runs/*`
- `lib/server/siwe.ts`, `lib/server/runs.ts`
- `services/geminiService.ts`, `App.tsx`, `types.ts`
