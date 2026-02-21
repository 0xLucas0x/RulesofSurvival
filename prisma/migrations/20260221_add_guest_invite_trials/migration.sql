-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('WALLET', 'GUEST');

-- CreateEnum
CREATE TYPE "public"."GuestInviteStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED');

-- AlterTable
ALTER TABLE "public"."users"
ADD COLUMN "auth_provider" "public"."AuthProvider" NOT NULL DEFAULT 'WALLET';

-- CreateTable
CREATE TABLE "public"."guest_invite_codes" (
    "id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "status" "public"."GuestInviteStatus" NOT NULL DEFAULT 'ACTIVE',
    "campaign" TEXT,
    "expires_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "used_by_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_invite_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_invite_codes_code_hash_key" ON "public"."guest_invite_codes"("code_hash");

-- CreateIndex
CREATE INDEX "guest_invite_codes_status_expires_at_idx" ON "public"."guest_invite_codes"("status", "expires_at");

-- CreateIndex
CREATE INDEX "guest_invite_codes_used_by_user_id_idx" ON "public"."guest_invite_codes"("used_by_user_id");

-- CreateIndex
CREATE INDEX "guest_invite_codes_created_at_idx" ON "public"."guest_invite_codes"("created_at");

-- AddForeignKey
ALTER TABLE "public"."guest_invite_codes"
ADD CONSTRAINT "guest_invite_codes_used_by_user_id_fkey"
FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."guest_invite_codes"
ADD CONSTRAINT "guest_invite_codes_created_by_fkey"
FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
