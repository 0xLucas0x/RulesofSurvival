-- CreateEnum
CREATE TYPE "public"."RunActorType" AS ENUM ('HUMAN', 'AGENT');

-- AlterTable
ALTER TABLE "public"."game_runs"
ADD COLUMN "actor_type" "public"."RunActorType" NOT NULL DEFAULT 'HUMAN';

-- CreateIndex
CREATE INDEX "game_runs_status_actor_type_updated_at_idx" ON "public"."game_runs"("status", "actor_type", "updated_at");
