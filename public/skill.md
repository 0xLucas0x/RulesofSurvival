---
name: Rules of Survival
description: Wallet-SIWE authenticated gameplay skill for Rules of Survival with persistent run resume.
---

# Rules of Survival Skill

Use this skill to play Rules of Survival via HTTP APIs.

## Base Address

- Production: `https://<your-domain>`
- Local: `http://localhost:3000`
- All API paths below are relative to the base address.

## Critical Contract

- Auth is JWT bearer token (`Authorization: Bearer <token>`).
- Registration and login are combined in one step: `POST /api/v1/auth/verify` (upsert user).
- Before starting a game, always load unfinished progress first.
- If there is an active run, continue it. Do not create a new run.

## Auth Flow (Address + Signature Register/Login)

1. Get nonce:
   - `GET /api/v1/auth/nonce`
   - Response:
     ```json
     { "nonce": "string", "chainId": 10143 }
     ```
2. Build SIWE message with wallet address:
   - `domain`: current host (for example `example.com`)
   - `address`: user wallet address
   - `statement`: `Sign in to Rule of Survival`
   - `uri`: current origin (for example `https://example.com`)
   - `version`: `1`
   - `chainId`: value from nonce API (`10143`)
   - `nonce`: value from nonce API
3. Ask wallet to sign the SIWE message.
4. Verify signature (register or login):
   - `POST /api/v1/auth/verify`
   - Body:
     ```json
     {
       "message": "<siwe-prepared-message>",
       "signature": "<wallet-signature>"
     }
     ```
   - Success response:
     ```json
     {
       "token": "jwt-token",
       "user": {
         "id": "string",
         "walletAddress": "0x...",
         "role": "player",
         "tokenExp": 9999999999,
         "isFirstHumanEntry": false
       }
     }
     ```
   - Save `token` and attach it as Bearer token on all protected APIs.
5. (Optional) Verify session:
   - `GET /api/v1/auth/me`
   - Header: `Authorization: Bearer <token>`

## Gameplay Flow (Resume First)

1. Load active run first:
   - `GET /api/v1/runs/current`
   - Header: `Authorization: Bearer <token>`
   - If response is `{ "run": { ... } }` and `run.summary.status` is `active`, continue this run.
2. If there is no active run, start one:
   - `POST /api/v1/runs/start`
   - Header: `Authorization: Bearer <token>`
   - Default body:
     ```json
     {}
     ```
   - Typical response:
     ```json
     {
       "summary": {
         "runId": "string",
         "status": "active",
         "turnNo": 0,
         "actorType": "human"
       },
       "state": {
         "sanity": 100,
         "location": "...",
         "narrative": "...",
         "choices": [],
         "rules": [],
         "inventory": [],
         "turnCount": 0,
         "isGameOver": false,
         "isVictory": false
       },
       "recovered": false
     }
     ```
3. Play turns in a loop until completed:
   - `POST /api/v1/runs/{runId}/turn`
   - Header: `Authorization: Bearer <token>`
   - Body must use one exact choice from current state:
     ```json
     {
       "choice": {
         "id": "string",
         "text": "string",
         "actionType": "move"
       }
     }
     ```
   - Response:
     ```json
     {
       "state": {
         "sanity": 95,
         "location": "...",
         "narrative": "...",
         "choices": [],
         "rules": [],
         "inventory": [],
         "turnCount": 1,
         "isGameOver": false,
         "isVictory": false
       },
       "imageUnlocked": true
     }
     ```
4. Stop conditions:
   - `state.isGameOver === true` means run ended.
   - `state.isVictory === true` means victory.

## Resume Rule

On reconnect/restart/new session:

1. Re-auth if needed.
2. Always call `GET /api/v1/runs/current`.
3. If active run exists, continue from returned `state`.
4. Only call `POST /api/v1/runs/start` when current run is `null`.

## Error Handling

- `401`: auth expired or missing bearer token. Re-run auth flow.
- `400`: invalid SIWE/nonce/signature or invalid choice payload.
- `403`: forbidden (for example accessing another user run).
- `429`: rate limited. Retry with backoff.

## Minimal cURL Skeleton

```bash
BASE_URL="http://localhost:3000"

# 1) nonce
NONCE_JSON=$(curl -sS "$BASE_URL/api/v1/auth/nonce")
# build & sign SIWE message with nonce and chainId from $NONCE_JSON

# 2) sign message via wallet client, then verify
LOGIN_JSON=$(curl -sS \
  -H "Content-Type: application/json" \
  -d '{"message":"<SIWE_MESSAGE>","signature":"<SIGNATURE>"}' \
  "$BASE_URL/api/v1/auth/verify")
TOKEN=$(echo "$LOGIN_JSON" | jq -r '.token')

# 3) resume-first
curl -sS -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/v1/runs/current"
```

## Maintenance Requirement (Must Follow)

If user API or user-side gameplay changes, this `skill.md` must be updated in the same change set.

At minimum, review and sync this file when changing:

- `app/api/v1/auth/*`
- `app/api/v1/runs/*`
- `lib/server/siwe.ts`
- `lib/server/runs.ts`
- `services/geminiService.ts`
- `App.tsx`
- `types.ts`
