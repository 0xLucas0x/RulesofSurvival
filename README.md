# 规则求生 · Rules of Survival

> 📖 [English version](./README.en.md)

基于 Next.js 15 构建的钱包认证、AI 驱动生存恐怖文字 RPG。玩家通过 SIWE（以太坊签名登录）接入，在 Google Gemini 驱动的恐怖叙事世界中求生。每局游戏持久化存储于服务端，玩家可跨会话续局。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 框架 | Next.js 15（App Router，Turbopack） |
| 语言 | TypeScript 5.8 |
| UI | React 19，Tailwind CSS 3 |
| 认证 | SIWE v3 + Dynamic SDK + JWT（`jose`） |
| AI | Google Gemini（`@google/genai`） |
| 数据库 | PostgreSQL（Neon）via Prisma 6 |
| 链 | Monad Testnet（EVM，chainId 10143） |
| 缓存 / SSE | Redis（可选） |
| 国际化 | i18next + react-i18next（中 / 英） |

---

## 项目结构

```
app/
├── page.tsx          # 落地页
├── game/             # 游戏主客户端
├── intro/            # 开场序列
├── board/            # 公开实时看板（SSE）
├── admin/            # 管理后台（钱包权限）
├── lab/              # 调试实验室（仅管理员）
└── api/v1/
    ├── auth/         # Nonce、验签、登出、会话
    ├── runs/         # 开局、续局、回合、历史
    ├── stats/        # 落地页统计
    ├── leaderboard/  # 玩家排行榜
    ├── board/        # 快照 + SSE 直播
    └── admin/        # 配置、解锁策略、白名单
```

---

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local，填入以下变量
```

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接字符串（Neon 或自托管） |
| `NEXT_PUBLIC_DYNAMIC_ENV_ID` | ✅ | Dynamic.xyz 钱包连接环境 ID |
| `JWT_SECRET` | ✅ | JWT 签名密钥（≥ 32 字符） |
| `CONFIG_ENCRYPTION_KEY` | ✅ | 运行时配置加密密钥（32 字节） |
| `ADMIN_WALLET_ADDRESSES` | ✅ | 管理员钱包地址，逗号分隔 |
| `SIWE_DOMAIN` | ✅ | SIWE 消息域名（如 `localhost:3000`） |
| `APP_BASE_URL` | ✅ | 应用完整 origin（如 `http://localhost:3000`） |
| `MONAD_RPC_URL` | ✅ | Monad Testnet RPC，用于链上解锁校验 |
| `API_KEY` | ☑️ | Gemini 备用 API Key（可在管理后台覆盖） |
| `REDIS_URL` | ☑️ | Redis 地址，用于看板缓存 / SSE（可选） |
| `REDIS_KEY_PREFIX` | ☑️ | Redis Key 前缀（默认：`ros`） |

### 3. 初始化数据库

```bash
pnpm prisma:generate   # 生成 Prisma Client
pnpm prisma:deploy     # 应用数据库迁移
```

### 4. 启动开发服务器

```bash
pnpm dev
```

### 5. 生产构建

```bash
pnpm build
pnpm start
```

---

## 数据库表结构

Schema 位于 `prisma/schema.prisma`，核心表分组如下：

| 分组 | 表名 |
|---|---|
| 认证 | `users`，`siwe_nonces`，`jwt_revocations` |
| 配置 | `runtime_config`，`image_unlock_policy` |
| 访问控制 | `image_unlock_whitelist`，`nft_requirements`，`token_requirements` |
| 游戏数据 | `game_runs`，`game_turns`，`run_results` |
| 数据分析 | `user_metrics_all_time`，`user_metrics_7d`，`landing_daily_stats` |

---

## API 一览

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/auth/nonce` | 获取 SIWE Nonce |
| `POST` | `/api/v1/auth/verify` | 验签登录（新用户自动注册） |
| `POST` | `/api/v1/auth/guest/redeem` | 邀请码游客登录（一次性） |
| `POST` | `/api/v1/auth/logout` | 吊销 JWT |
| `GET` | `/api/v1/auth/me` | 获取当前会话 |

### 游戏

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/v1/runs/start` | 开始新游戏 |
| `GET` | `/api/v1/runs/current` | 获取当前进行中的游戏 |
| `GET` | `/api/v1/runs/:runId` | 按 ID 获取游戏记录 |
| `POST` | `/api/v1/runs/:runId/turn` | 提交回合选择 |
| `GET` | `/api/v1/runs/:runId/turns` | 获取回合历史 |

### 统计与排行

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/v1/stats/landing` | 落地页统计数据 |
| `GET` | `/api/v1/leaderboard` | 排行榜（`board`、`window` 参数） |
| `GET` | `/api/v1/board/snapshot` | 当前看板快照（公开） |
| `GET` | `/api/v1/board/stream` | 实时 SSE 看板（公开） |

### 管理员（role = `admin`）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET/PUT` | `/api/v1/admin/config` | LLM / 图像运行时配置 |
| `GET/PUT` | `/api/v1/admin/unlock-policy` | 图像解锁策略 |
| `GET/POST` | `/api/v1/admin/guest-invites` | 游客邀请码管理 |
| `POST/DELETE` | `/api/v1/admin/unlock-whitelist` | 钱包白名单 |
| `POST/DELETE` | `/api/v1/admin/nft-requirements` | NFT 门控规则 |
| `POST/DELETE` | `/api/v1/admin/token-requirements` | Token 门控规则 |

---

## 访问权限

| 路由 | 权限 |
|---|---|
| `/` | 公开 |
| `/guest` | 公开（邀请码游客入口） |
| `/game`，`/intro` | 已认证玩家 |
| `/board` | 公开 |
| `/admin` | 仅管理员钱包 |
| `/lab` | 仅管理员钱包 |
| `POST /api/v1/runs/:runId/turn` | 已认证玩家（Run 归属者） |
| `POST /api/v1/game/turn` | 仅管理员调试 |

---

## 常用命令

```bash
pnpm dev                               # 开发服务器（Turbopack）
pnpm dev:webpack                       # 开发服务器（Webpack 回退）
pnpm build                            # 生产构建
pnpm start                            # 启动生产服务
pnpm prisma:generate                  # 重新生成 Prisma Client
pnpm prisma:migrate                   # 创建新迁移（仅开发环境）
pnpm prisma:deploy                    # 应用已有迁移
node scripts/test-gameplay-nvidia.mjs # 无头游戏流程测试
```

---

## AI Agent 集成

机器可读的技能描述文件位于 [`/skill.md`](./public/skill.md)，供外部 AI Agent 通过 HTTP 与游戏交互，包含完整的认证与游戏 API 契约。

代码库开发规范详见 [`AGENTS.md`](./AGENTS.md)。
