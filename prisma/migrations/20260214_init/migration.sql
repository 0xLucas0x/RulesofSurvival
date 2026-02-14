-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('PLAYER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "public"."GameRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."NftTokenStandard" AS ENUM ('ERC721', 'ERC1155');

-- CreateEnum
CREATE TYPE "public"."LlmProvider" AS ENUM ('GEMINI', 'OPENAI');

-- CreateEnum
CREATE TYPE "public"."ImageProvider" AS ENUM ('POLLINATIONS', 'OPENAI');

-- CreateEnum
CREATE TYPE "public"."UnlockLogic" AS ENUM ('ANY');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" UUID NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'PLAYER',
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."siwe_nonces" (
    "id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "wallet_address" TEXT,
    "user_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "siwe_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."jwt_revocations" (
    "id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "jwt_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."runtime_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "llm_provider" "public"."LlmProvider" NOT NULL DEFAULT 'GEMINI',
    "llm_base_url" TEXT,
    "llm_api_key_enc" TEXT,
    "llm_model" TEXT,
    "image_provider" "public"."ImageProvider" NOT NULL DEFAULT 'POLLINATIONS',
    "image_base_url" TEXT,
    "image_api_key_enc" TEXT,
    "image_model" TEXT,
    "game_config_json" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "runtime_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."image_unlock_policy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "logic" "public"."UnlockLogic" NOT NULL DEFAULT 'ANY',
    "chain_id" INTEGER NOT NULL DEFAULT 10143,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "image_unlock_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."image_unlock_whitelist" (
    "id" UUID NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_unlock_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."nft_requirements" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL DEFAULT 10143,
    "contract_address" TEXT NOT NULL,
    "token_standard" "public"."NftTokenStandard" NOT NULL,
    "token_id" TEXT,
    "min_balance" TEXT NOT NULL DEFAULT '1',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nft_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."token_requirements" (
    "id" UUID NOT NULL,
    "chain_id" INTEGER NOT NULL DEFAULT 10143,
    "contract_address" TEXT NOT NULL,
    "min_balance_raw" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 18,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."game_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "public"."GameRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "current_turn_no" INTEGER NOT NULL DEFAULT 0,
    "final_score" INTEGER,
    "final_sanity" INTEGER,
    "is_victory" BOOLEAN,
    "config_snapshot_json" JSONB NOT NULL,
    "last_turn_id" UUID,
    "active_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."game_turns" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "turn_no" INTEGER NOT NULL,
    "input_json" JSONB NOT NULL,
    "output_json" JSONB NOT NULL,
    "state_before_json" JSONB NOT NULL,
    "state_after_json" JSONB NOT NULL,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."run_results" (
    "run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "is_victory" BOOLEAN NOT NULL,
    "turns" INTEGER NOT NULL,
    "final_sanity" INTEGER NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_results_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "public"."user_metrics_all_time" (
    "user_id" UUID NOT NULL,
    "composite_score" INTEGER NOT NULL DEFAULT 0,
    "victories" INTEGER NOT NULL DEFAULT 0,
    "completed_runs" INTEGER NOT NULL DEFAULT 0,
    "active_days" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_metrics_all_time_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."user_metrics_7d" (
    "user_id" UUID NOT NULL,
    "composite_score" INTEGER NOT NULL DEFAULT 0,
    "victories" INTEGER NOT NULL DEFAULT 0,
    "completed_runs" INTEGER NOT NULL DEFAULT 0,
    "active_days" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_metrics_7d_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."landing_daily_stats" (
    "date" DATE NOT NULL,
    "dau" INTEGER NOT NULL DEFAULT 0,
    "runs_started" INTEGER NOT NULL DEFAULT 0,
    "runs_completed" INTEGER NOT NULL DEFAULT 0,
    "victory_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_daily_stats_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_wallet_address_key" ON "public"."users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "siwe_nonces_nonce_key" ON "public"."siwe_nonces"("nonce");

-- CreateIndex
CREATE UNIQUE INDEX "jwt_revocations_jti_key" ON "public"."jwt_revocations"("jti");

-- CreateIndex
CREATE INDEX "jwt_revocations_user_id_idx" ON "public"."jwt_revocations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "image_unlock_whitelist_wallet_address_key" ON "public"."image_unlock_whitelist"("wallet_address");

-- CreateIndex
CREATE INDEX "nft_requirements_enabled_idx" ON "public"."nft_requirements"("enabled");

-- CreateIndex
CREATE INDEX "nft_requirements_chain_id_contract_address_idx" ON "public"."nft_requirements"("chain_id", "contract_address");

-- CreateIndex
CREATE INDEX "token_requirements_enabled_idx" ON "public"."token_requirements"("enabled");

-- CreateIndex
CREATE INDEX "token_requirements_chain_id_contract_address_idx" ON "public"."token_requirements"("chain_id", "contract_address");

-- CreateIndex
CREATE UNIQUE INDEX "game_runs_active_key_key" ON "public"."game_runs"("active_key");

-- CreateIndex
CREATE INDEX "game_runs_user_id_status_idx" ON "public"."game_runs"("user_id", "status");

-- CreateIndex
CREATE INDEX "game_runs_started_at_idx" ON "public"."game_runs"("started_at");

-- CreateIndex
CREATE INDEX "game_turns_run_id_created_at_idx" ON "public"."game_turns"("run_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_turns_run_id_turn_no_key" ON "public"."game_turns"("run_id", "turn_no");

-- CreateIndex
CREATE INDEX "run_results_user_id_completed_at_idx" ON "public"."run_results"("user_id", "completed_at");

-- AddForeignKey
ALTER TABLE "public"."siwe_nonces" ADD CONSTRAINT "siwe_nonces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jwt_revocations" ADD CONSTRAINT "jwt_revocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."game_runs" ADD CONSTRAINT "game_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."game_turns" ADD CONSTRAINT "game_turns_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."game_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."run_results" ADD CONSTRAINT "run_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."game_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."run_results" ADD CONSTRAINT "run_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_metrics_all_time" ADD CONSTRAINT "user_metrics_all_time_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_metrics_7d" ADD CONSTRAINT "user_metrics_7d_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

