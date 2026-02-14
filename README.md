# Rules of Survival

Rules-horror text adventure game built with Next.js + React + TypeScript.

## What changed (Web3 + persistence)

This version includes:

- SIWE wallet auth (`/api/v1/auth/*`) with JWT HttpOnly cookie sessions.
- Prisma + Neon(PostgreSQL) persistence for users, runs, turns, config, and stats.
- Recoverable runs (`/api/v1/runs/*`) with one active run per wallet.
- Landing statistics + leaderboard APIs.
- Admin console (`/admin`) for runtime LLM/image config and image unlock rules.
- Image unlock gating by wallet whitelist/NFT/token on Monad Testnet.

## Run locally

1. Install dependencies

```bash
pnpm install
```

2. Configure environment

```bash
cp .env.example .env.local
# then edit .env.local
```

Required variables are documented in `.env`, including `NEXT_PUBLIC_DYNAMIC_ENV_ID` for Dynamic wallet connect.

3. Generate Prisma client and apply migrations

```bash
pnpm prisma:generate
pnpm prisma:deploy
```

4. Start dev server

```bash
pnpm dev
```

5. Build production

```bash
pnpm build
pnpm start
```

## Database

- Schema: `prisma/schema.prisma`
- Initial migration: `prisma/migrations/20260214_init/migration.sql`

Core tables include:

- `users`, `siwe_nonces`, `jwt_revocations`
- `runtime_config`, `image_unlock_policy`, `image_unlock_whitelist`
- `nft_requirements`, `token_requirements`
- `game_runs`, `game_turns`, `run_results`
- `user_metrics_all_time`, `user_metrics_7d`, `landing_daily_stats`

## API overview

### Auth

- `GET /api/v1/auth/nonce`
- `POST /api/v1/auth/verify`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### Gameplay persistence

- `POST /api/v1/runs/start`
- `GET /api/v1/runs/current`
- `GET /api/v1/runs/:runId`
- `POST /api/v1/runs/:runId/turn`
- `GET /api/v1/runs/:runId/turns`

### Landing / leaderboard

- `GET /api/v1/stats/landing`
- `GET /api/v1/leaderboard?board=composite|clear|active&window=7d|all`

### Admin (wallet role = admin)

- `GET/PUT /api/v1/admin/config`
- `GET/PUT /api/v1/admin/unlock-policy`
- `POST/DELETE /api/v1/admin/unlock-whitelist`
- `POST/DELETE /api/v1/admin/nft-requirements`
- `POST/DELETE /api/v1/admin/token-requirements`

## Access control notes

- `/admin` and `/lab` are admin-only pages.
- `/api/v1/game/turn` is now admin debug-only (for lab/debug workflows).
- Player gameplay should use `/api/v1/runs/:runId/turn`.

## Legacy test lab

The visual lab still exists at `/lab` and is now restricted to admin sessions.
