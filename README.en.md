# Rules of Survival

> 📖 [中文版本](./README.md)

A wallet-authenticated, AI-driven survival-horror text RPG built on Next.js 15. Players connect via SIWE (Sign-In with Ethereum), then navigate a procedurally narrated horror scenario powered by Google Gemini. Each run is persisted server-side; players can resume across sessions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript 5.8 |
| UI | React 19, Tailwind CSS 3 |
| Auth | SIWE v3 + Dynamic SDK + JWT (`jose`) |
| AI | Google Gemini (`@google/genai`) |
| Database | PostgreSQL (Neon) via Prisma 6 |
| Chain | Monad Testnet (EVM, chainId 10143) |
| Cache / SSE | Redis (optional) |
| i18n | i18next + react-i18next (EN / ZH) |

---

## Architecture

```
app/
├── page.tsx          # Landing page
├── game/             # Main game client
├── intro/            # Intro sequence
├── board/            # Public live board (SSE)
├── admin/            # Admin console (wallet-gated)
├── lab/              # Debug lab (admin-only)
└── api/v1/
    ├── auth/         # Nonce, verify, logout, me
    ├── runs/         # Start, resume, turn, history
    ├── stats/        # Landing statistics
    ├── leaderboard/  # Player rankings
    ├── board/        # Snapshot + SSE stream
    └── admin/        # Config, unlock policy, whitelist
```

---

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
# Edit .env.local with your values
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Neon or self-hosted) |
| `NEXT_PUBLIC_DYNAMIC_ENV_ID` | ✅ | Dynamic.xyz environment ID for wallet connect |
| `JWT_SECRET` | ✅ | ≥ 32-char secret for JWT signing |
| `CONFIG_ENCRYPTION_KEY` | ✅ | 32-byte key for encrypting runtime config |
| `ADMIN_WALLET_ADDRESSES` | ✅ | Comma-separated admin wallet addresses |
| `SIWE_DOMAIN` | ✅ | Domain used in SIWE messages (e.g. `localhost:3000`) |
| `APP_BASE_URL` | ✅ | Full app origin (e.g. `http://localhost:3000`) |
| `MONAD_RPC_URL` | ✅ | Monad Testnet RPC for on-chain unlock checks |
| `API_KEY` | ☑️ | Fallback Gemini API key (overrideable via admin) |
| `REDIS_URL` | ☑️ | Redis for public board caching / SSE (optional) |
| `REDIS_KEY_PREFIX` | ☑️ | Redis key namespace (default: `ros`) |

### 3. Initialize database

```bash
pnpm prisma:generate   # Generate Prisma client
pnpm prisma:deploy     # Apply migrations to DB
```

### 4. Start development server

```bash
pnpm dev               # Next.js + Turbopack
```

### 5. Build for production

```bash
pnpm build
pnpm start
```

---

## Database Schema

Schema lives in `prisma/schema.prisma`. Core table groups:

| Group | Tables |
|---|---|
| Auth | `users`, `siwe_nonces`, `jwt_revocations` |
| Config | `runtime_config`, `image_unlock_policy` |
| Access control | `image_unlock_whitelist`, `nft_requirements`, `token_requirements` |
| Gameplay | `game_runs`, `game_turns`, `run_results` |
| Analytics | `user_metrics_all_time`, `user_metrics_7d`, `landing_daily_stats` |

---

## API Reference

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/auth/nonce` | Issue a SIWE nonce |
| `POST` | `/api/v1/auth/verify` | Verify signature — register or login (upsert) |
| `POST` | `/api/v1/auth/guest/redeem` | Redeem guest invite code (one-time) |
| `POST` | `/api/v1/auth/logout` | Revoke JWT |
| `GET` | `/api/v1/auth/me` | Get current session |

### Gameplay

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/runs/start` | Start a new run |
| `GET` | `/api/v1/runs/current` | Resume active run |
| `GET` | `/api/v1/runs/:runId` | Get run by ID |
| `POST` | `/api/v1/runs/:runId/turn` | Submit a turn choice |
| `GET` | `/api/v1/runs/:runId/turns` | Get turn history |

### Stats & Leaderboard

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/stats/landing` | Landing page stats |
| `GET` | `/api/v1/leaderboard` | Rankings (`board`, `window` query params) |
| `GET` | `/api/v1/board/snapshot` | Current board snapshot (public) |
| `GET` | `/api/v1/board/stream` | Live SSE board stream (public) |

### Admin (role = `admin`)

| Method | Endpoint | Description |
|---|---|---|
| `GET/PUT` | `/api/v1/admin/config` | LLM / image runtime config |
| `GET/PUT` | `/api/v1/admin/unlock-policy` | Image unlock policy |
| `GET/POST` | `/api/v1/admin/guest-invites` | Guest invite management |
| `POST/DELETE` | `/api/v1/admin/unlock-whitelist` | Wallet whitelist |
| `POST/DELETE` | `/api/v1/admin/nft-requirements` | NFT-gated access rules |
| `POST/DELETE` | `/api/v1/admin/token-requirements` | Token-gated access rules |

---

## Access Control

| Route | Access |
|---|---|
| `/` | Public |
| `/guest` | Public (invite-code guest entry) |
| `/game`, `/intro` | Authenticated players |
| `/board` | Public |
| `/admin` | Admin wallets only |
| `/lab` | Admin wallets only |
| `POST /api/v1/runs/:runId/turn` | Authenticated player (run owner) |
| `POST /api/v1/game/turn` | Admin debug only |

---

## Development Scripts

```bash
pnpm dev                               # Dev server (Turbopack)
pnpm dev:webpack                       # Dev server (Webpack fallback)
pnpm build                            # Production build
pnpm start                            # Serve production build
pnpm prisma:generate                  # Regenerate Prisma client
pnpm prisma:migrate                   # New migration (dev only)
pnpm prisma:deploy                    # Apply existing migrations
node scripts/test-gameplay-nvidia.mjs # Headless gameplay test
```

---

## AI Agent / Skill Integration

A machine-readable skill descriptor is available at [`/skill.md`](./public/skill.md) for AI agents that interact with the game via HTTP. It documents the full auth + gameplay API contract in structured form.

See also [`AGENTS.md`](./AGENTS.md) for repository coding conventions.
