-- Rolling quota anchor (first import) + Max plan support
ALTER TABLE "users" ADD COLUMN "quota_anchor_at" TIMESTAMPTZ(6);
