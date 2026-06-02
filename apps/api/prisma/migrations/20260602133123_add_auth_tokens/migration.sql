/*
  Warnings:

  - A unique constraint covering the columns `[google_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "google_id" TEXT;

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "polling_id" TEXT NOT NULL,
    "user_id" UUID,
    "type" TEXT NOT NULL,
    "jwt" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_key" ON "auth_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_polling_id_key" ON "auth_tokens"("polling_id");

-- CreateIndex
CREATE INDEX "auth_tokens_polling_id_idx" ON "auth_tokens"("polling_id");

-- CreateIndex
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
