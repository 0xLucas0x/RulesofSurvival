# Rule of Survival Web3 登录与可恢复会话系统设计（SIWE + JWT + Neon）

## 简要总结
本方案采用你确认的路径：`单体 Next.js`（同仓库）+ `Neon(PostgreSQL)` + `Prisma`，实现以下目标：
1. 钱包登录注册：纯自研 `SIWE + 单 JWT(30天)`，并支持服务端注销黑名单。
2. 多次游玩与恢复：按“地址即账号”，每用户同一时刻仅 1 局进行中，自动恢复最近未结束局。
3. 全量回合持久化：每回合输入、输出、前后状态完整落库，支持恢复与复盘。
4. Landing 统计：综合榜、通关榜、活跃榜，支持 `7天滚动 + 全量累计`。
5. 管理端：钱包白名单管理员，配置难度/模型/图片解锁规则，不需玩家上传 key/baseUrl。
6. 图片解锁：全局规则，`ANY` 逻辑，条件为白名单/NFT/Token（Monad Testnet，RPC 直连）。

## 架构设计
1. 前端层：现有 Next.js 页面保持，新增 `wallet connect + SIWE` 登录入口、会话恢复入口、Landing 动态统计模块、基础 Admin 页面。
2. API 层：继续使用 `app/api/v1/*`，新增 `auth/runs/stats/leaderboard/admin` 路由组。
3. 业务层：新增 `lib/server/auth`, `lib/server/runs`, `lib/server/config`, `lib/server/entitlement`, `lib/server/stats`。
4. 数据层：Prisma + Neon，所有运行态数据（用户、run、turn、配置、榜单聚合）落库。
5. 外部依赖：Monad Testnet RPC（持仓校验），LLM/Image Provider（由管理端配置托管）。

## 数据模型（Prisma 目标表）
1. `users`
字段：`id(uuid)`, `wallet_address(unique, lowercased)`, `role(player|admin)`, `status(active|banned)`, `created_at`, `last_login_at`.
2. `siwe_nonces`
字段：`id`, `nonce(unique)`, `wallet_address(nullable)`, `expires_at`, `used_at(nullable)`, `created_ip`, `user_agent`.
3. `jwt_revocations`
字段：`id`, `jti(unique)`, `user_id`, `revoked_at`, `expires_at`, `reason`.
4. `runtime_config`
字段：`id(singleton)`, `llm_provider`, `llm_base_url`, `llm_api_key_enc`, `llm_model`, `image_provider`, `image_base_url`, `image_api_key_enc`, `image_model`, `game_config_json`, `updated_at`, `updated_by`.
5. `image_unlock_policy`
字段：`id(singleton)`, `enabled`, `logic(ANY固定)`, `chain_id(10143)`, `updated_at`, `updated_by`.
6. `image_unlock_whitelist`
字段：`id`, `wallet_address(unique)`, `enabled`, `note`, `created_at`.
7. `nft_requirements`
字段：`id`, `chain_id`, `contract_address`, `token_standard(erc721|erc1155)`, `token_id(nullable)`, `min_balance`, `enabled`.
8. `token_requirements`
字段：`id`, `chain_id`, `contract_address`, `min_balance_raw`, `decimals`, `enabled`.
9. `game_runs`
字段：`id(uuid)`, `user_id`, `status(active|completed|abandoned|failed)`, `started_at`, `ended_at(nullable)`, `current_turn_no`, `final_score(nullable)`, `final_sanity(nullable)`, `is_victory(nullable)`, `config_snapshot_json`, `last_turn_id(nullable)`.
约束：`(user_id, status=active)` 唯一，保证同用户仅一局进行中。
10. `game_turns`
字段：`id(uuid)`, `run_id`, `turn_no`, `input_json`, `output_json`, `state_before_json`, `state_after_json`, `latency_ms`, `created_at`.
约束：`(run_id, turn_no)` 唯一。
11. `run_results`
字段：`run_id(pk)`, `user_id`, `score`, `is_victory`, `turns`, `final_sanity`, `completed_at`.
12. `user_metrics_all_time`
字段：`user_id(pk)`, `composite_score`, `victories`, `completed_runs`, `active_days`, `updated_at`.
13. `user_metrics_7d`
字段：与 all_time 同结构，按窗口维护。
14. `landing_daily_stats`
字段：`date(pk)`, `dau`, `runs_started`, `runs_completed`, `victory_rate`, `avg_score`, `updated_at`.

## 公开 API / 接口变更（重点）
1. 认证接口
`GET /api/v1/auth/nonce`：生成 nonce。  
`POST /api/v1/auth/verify`：校验 SIWE 消息与签名，签发 JWT cookie。  
`POST /api/v1/auth/logout`：写入 `jwt_revocations`。  
`GET /api/v1/auth/me`：返回当前用户地址与角色。
2. 游戏接口
`POST /api/v1/runs/start`：创建新局（若已有 active 返回该局）。  
`GET /api/v1/runs/current`：获取当前进行中局。  
`GET /api/v1/runs/:runId`：获取局摘要与当前状态。  
`POST /api/v1/runs/:runId/turn`：提交一步，服务端调用 AI，记录 turn，更新 run。  
`GET /api/v1/runs/:runId/turns`：分页回放（用于恢复与分析）。
3. Landing 接口
`GET /api/v1/stats/landing`：返回 7d + all-time 核心指标。  
`GET /api/v1/leaderboard?board=composite|clear|active&window=7d|all`。
4. 管理接口（admin only）
`GET /api/v1/admin/config`，`PUT /api/v1/admin/config`。  
`GET /api/v1/admin/unlock-policy`，`PUT /api/v1/admin/unlock-policy`。  
`POST/DELETE /api/v1/admin/unlock-whitelist`。  
`POST/DELETE /api/v1/admin/nft-requirements`。  
`POST/DELETE /api/v1/admin/token-requirements`。
5. 现有接口调整
`/api/v1/game/turn` 从“接收前端 key/baseUrl”改为“仅由受控 run 流程调用”，玩家端不再上传 provider 凭据。  
`/lab` 改为 admin 可见，并保留手工 key/baseUrl 测试模式。

## 前端类型与状态变更（重点）
1. 新增 `AuthUser`
字段：`id`, `walletAddress`, `role`, `tokenExp`.
2. 新增 `RunSummary`
字段：`runId`, `status`, `turnNo`, `sanity`, `location`, `isVictory?`, `startedAt`.
3. 新增 `TurnSnapshot`
字段：`turnNo`, `input`, `output`, `stateBefore`, `stateAfter`, `createdAt`.
4. 新增 `LandingStats` 与 `LeaderboardEntry`。
5. 现有 `GameState` 增加 `runId`, `isRecovering`, `lastSyncedTurn`.
6. 设置页移除普通玩家的 key/baseUrl 输入；仅 admin 页保留配置入口。

## 关键业务流程
1. SIWE 登录流程
前端请求 nonce -> 钱包签名 SIWE message -> 服务端验证域名/nonce/链ID/过期 -> upsert 用户 -> 发 JWT(HttpOnly, Secure, SameSite=Lax, 30天, 含 jti)。
2. 自动恢复流程
用户进入游戏页 -> 调 `GET /runs/current` -> 有 active 则加载最近 `state_after` 恢复 -> 无 active 可 `start` 新局。
3. 回合处理流程
前端提交 choice -> 服务端校验 run 所有权与 active 状态 -> 读取 run 的 `config_snapshot` -> 调用 AI 引擎 -> 落 `game_turns` -> 更新 `game_runs` -> 若结束写 `run_results` 并增量更新统计表。
4. 图片解锁流程
回合返回图片前，服务端按全局 ANY 规则判定：白名单命中 或 NFT 持仓命中 或 Token 持仓命中 -> 命中才调用图片生成；未命中返回占位图与提示。
5. 配置生效规则
管理员 `PUT admin/config` 后立即成为“当前配置”；只作用于新开局。进行中局始终使用开局时 `config_snapshot`。

## 评分与榜单规则（首版固定）
1. 综合分 `composite_score`
建议公式：`base(通关加分) + sanity权重 + 证据权重 - 超长回合惩罚`，由服务端统一计算。
2. 通关榜
按 `victories`、`平均完成回合` 排序。
3. 活跃榜
按 `active_days(7d)`、`completed_runs(7d)` 排序。
4. 展示身份
仅显示脱敏地址 `0x1234...abcd`。

## 安全与成本控制
1. 鉴权
JWT 仅存 HttpOnly Cookie，不落 localStorage；每次请求验签 + 查 revocation。
2. 限流
按 `wallet + IP` 双维度限流（登录、turn、图片生成、admin）。
3. 防作弊
分数仅服务端依据 `game_turns` 重算并入库；前端不提交最终分。
4. 密钥管理
管理端填写的 provider key/baseUrl 以应用层加密后存 DB；解密密钥仅存在部署环境变量。
5. 成本控制
未解锁用户不触发图片生成；Landing 使用聚合表读取，不做重查询。

## 实施分期
1. Phase 1 基础设施
引入 Prisma + Neon，完成迁移与基础模型。
2. Phase 2 认证
实现 SIWE nonce/verify/logout/me 与 JWT 中间件。
3. Phase 3 游戏持久化
实现 runs/turns 接口、自动恢复、单 active run 约束。
4. Phase 4 管理端
实现 admin 认证、配置管理、解锁规则管理、密钥加密存储。
5. Phase 5 榜单统计
实现 run 结束写时聚合、Landing/Leaderboard API 与前端展示。
6. Phase 6 加固
限流、错误观测、/lab 权限收口、回归测试与上线清单。

## 测试用例与验收场景
1. SIWE nonce 一次性：重放签名必须失败。
2. 非管理员钱包访问 `/api/v1/admin/*` 必须 403。
3. JWT 注销后同 token 再访问必须 401。
4. 同用户已有 active run 时重复 start 返回同 run，不新建。
5. 提交 turn 后 `game_turns` 必有 input/output/before/after 四类数据。
6. 页面刷新后自动恢复到最近未结束回合。
7. 改 admin 配置后，新开局使用新配置，旧局继续旧快照。
8. 未满足解锁条件时返回占位图，不触发真实图片生成。
9. 满足任一条件（ANY）即允许图片生成。
10. 完局后榜单与 landing 聚合值按预期增加。
11. 7d 窗口滚动后过期数据不再计入 7d 榜。
12. `/lab` 非 admin 不可访问，admin 可手动配置测试模型。

## 假设与默认值（已锁定）
1. 身份模型：地址即账号，不做多地址合并。
2. 角色模型：仅 `player/admin`。
3. 链：Monad Testnet（chainId `10143`）。
4. 解锁条件：白名单 + NFT + Token，全局规则，逻辑 ANY。
5. 会话：单 JWT，30天有效，支持服务端黑名单注销。
6. 数据留存：回合日志永久保存。
7. 配置生效：实时更新，但仅影响新开局。
8. 统计窗口：7天滚动 + 全量累计。
9. 技术栈：Next.js 单体、Prisma、Neon、Vercel 部署。
10. 审计日志：首版不做完整管理审计，仅保留常规更新时间与更新人字段。
