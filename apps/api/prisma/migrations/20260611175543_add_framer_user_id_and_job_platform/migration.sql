-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "platform" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "framer_user_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_framer_user_id_key" ON "users"("framer_user_id");

