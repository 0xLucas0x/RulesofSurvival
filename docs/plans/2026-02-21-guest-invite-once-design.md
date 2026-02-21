# Guest Invite One-Shot Trial Design

- Date: 2026-02-21
- Status: Approved
- Scope: Web2 guest entry with one-time invite code, one playable run per guest

## 1. Problem & Goal

Current game access requires wallet login for normal gameplay. We need a Web2-friendly trial path for growth campaigns.

Goals:

1. Guest can enter without wallet by redeeming an invite code.
2. Each invite code is single-use.
3. Each redeemed guest can create only one run total.
4. If that run is still active, guest can resume it from the same browser.
5. If that run is completed/failed, guest cannot start a new run.
6. Session remains in browser storage until user clears it.

Non-goals:

1. Strong device anti-fraud/fingerprinting.
2. Multi-run guest lifecycle.
3. Replacing existing wallet auth flow.

## 2. Product Behavior

Guest lifecycle:

1. Not redeemed: no guest token.
2. Redeemed + active run: can continue the active run.
3. Redeemed + run ended: trial consumed, cannot start another run.

Policy decisions:

1. Invite code policy: one code can be redeemed once.
2. User policy: one guest account can create one run lifetime.
3. Session policy: token persisted in browser local storage.

## 3. Architecture Approach

Recommended approach: reuse existing `User + JWT + /runs/*` pipeline with minimal extension.

Why:

1. Lowest implementation risk and fastest delivery.
2. Reuses existing auth middleware and run state machine.
3. Keeps gameplay APIs unchanged for client runtime.

Trade-off:

1. Guest users still map to `users` rows (expected and acceptable).

## 4. Data Model Changes

## 4.1 `users` extension

Add `authProvider`:

1. Enum: `WALLET | GUEST`
2. Default: `WALLET`
3. Purpose: enforce guest-specific run limits.

`walletAddress` remains required for backward compatibility. Guest rows use deterministic synthetic values (for example: `guest_<id-fragment>`), never user-supplied text.

## 4.2 New `guest_invite_codes` table

Suggested fields:

1. `id` (uuid)
2. `codeHash` (unique)
3. `status` (`ACTIVE | USED | REVOKED`)
4. `expiresAt` (nullable)
5. `usedAt` (nullable)
6. `usedByUserId` (nullable fk -> users.id)
7. `campaign` (nullable)
8. `createdBy` (nullable fk -> users.id)
9. `createdAt`, `updatedAt`

Security:

1. Store hash only (`sha256`), never plain code.
2. Return plain code only once at generation time.

## 5. API Design

## 5.1 Guest redeem

`POST /api/v1/auth/guest/redeem`

Request:

```json
{ "inviteCode": "ABCD-EFGH-IJKL" }
```

Response (same shape as wallet auth verify for frontend reuse):

```json
{
  "token": "<jwt>",
  "user": {
    "id": "<uuid>",
    "walletAddress": "guest_xxxx",
    "role": "player",
    "tokenExp": 1234567890,
    "isFirstHumanEntry": true,
    "authProvider": "guest"
  }
}
```

Behavior:

1. Validate input format.
2. Rate-limit by IP (`applyDualRateLimit`).
3. Hash code and lookup invite row.
4. Check `status`, expiration, and usage.
5. Transaction:
   - create guest user (`authProvider=GUEST`)
   - mark invite as used with `usedByUserId`, `usedAt`, `status=USED`
6. Sign standard auth token and return user payload.

## 5.2 Run start policy update

Endpoint unchanged: `POST /api/v1/runs/start`.

Rule for guest users:

1. If active run exists -> return recovered run (continue).
2. If no active run and user has any previous run -> reject with trial-consumed error.
3. Else -> create first run.

Rule for wallet users:

1. No behavior change.

## 5.3 Admin invite operations

Add:

1. `POST /api/v1/admin/guest-invites/batch`
2. `GET /api/v1/admin/guest-invites`

Batch create request example:

```json
{
  "count": 200,
  "expiresAt": "2026-03-31T23:59:59.000Z",
  "campaign": "launch_q2"
}
```

Batch create response includes plaintext codes once for export.

## 6. Frontend UX

## 6.1 Entry points

Landing:

1. Add `Guest Trial (Invite Code)` CTA.
2. Navigate to `/guest`.

New `/guest` page:

1. Invite code input + submit button.
2. Calls `POST /api/v1/auth/guest/redeem`.
3. On success writes existing auth token key (`ros_auth_token`) and redirects to `/game`.

## 6.2 In-game behavior

1. Extend `AuthUser` with `authProvider`.
2. Optional guest badge in `Header`.
3. If `startRun` returns trial-consumed error after run end, show terminal state page with:
   - trial completed message
   - `Back Home` CTA
   - optional `Connect Wallet` CTA

## 7. Error Contract

Suggested mapping:

1. `400` invalid invite format
2. `404` invite not found
3. `409` invite already used
4. `410` invite expired
5. `403` trial consumed (guest attempts second run)
6. `429` rate limit

Frontend will map these to user-facing Chinese/English messages.

## 8. Security & Abuse Notes

1. Code hash at rest; no plaintext persistence.
2. Redeem endpoint rate limited.
3. Invite redeem and consume are transactional to prevent double-spend race.
4. This design intentionally allows another trial only with a fresh invite code and clean browser/session behavior; strict device-level anti-fraud is deferred.

## 9. Testing Strategy

Unit/integration focus:

1. Redeem success path.
2. Duplicate redeem race (only one success).
3. Expired/revoked/used code paths.
4. Guest `startRun`: first run allowed, resume active allowed, second run denied.
5. Wallet run start unaffected.

Manual QA:

1. Guest redeem -> enter game -> create run -> refresh -> resume.
2. Complete run -> click restart -> see trial consumed UI.
3. Logout and re-open with same token -> still blocked for second run.
4. Landing and `/guest` localization and responsiveness.

## 10. Rollout Plan

1. Deploy backend schema + APIs behind no-breaking paths.
2. Add guest UI entry and `/guest` page.
3. Seed a small campaign batch and run smoke tests.
4. Monitor:
   - redeem success rate
   - first-run completion rate
   - post-trial wallet conversion (if CTA enabled)

## 11. Open Choices (Resolved)

1. One-time bound to invite code, not wallet/device.
2. Guest can resume unfinished run.
3. Browser persistence is long-lived (until local storage clear).

