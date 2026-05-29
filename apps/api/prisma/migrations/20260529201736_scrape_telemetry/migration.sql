-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usage_counters" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "webhook_events" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "scrape_telemetry" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endpoint" TEXT NOT NULL,
    "ig_username" TEXT NOT NULL,
    "session_account" TEXT,
    "proxy_used" BOOLEAN NOT NULL DEFAULT false,
    "cache_hit" BOOLEAN NOT NULL DEFAULT false,
    "status_code" INTEGER NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL,
    "error_kind" TEXT,
    "user_id" UUID,
    "plan_tier" TEXT,

    CONSTRAINT "scrape_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scrape_telemetry_created_at_idx" ON "scrape_telemetry"("created_at" DESC);

-- CreateIndex
CREATE INDEX "scrape_telemetry_ig_username_created_at_idx" ON "scrape_telemetry"("ig_username", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scrape_telemetry_session_account_created_at_idx" ON "scrape_telemetry"("session_account", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scrape_telemetry_error_kind_created_at_idx" ON "scrape_telemetry"("error_kind", "created_at" DESC);
