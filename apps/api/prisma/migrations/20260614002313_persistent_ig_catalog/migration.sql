-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "kind" TEXT,
ADD COLUMN     "media_asset_id" UUID,
ADD COLUMN     "shortcode" TEXT,
ADD COLUMN     "slot" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "media_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shortcode" TEXT,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "content_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_profiles" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "ig_user_id" TEXT,
    "full_name" TEXT,
    "biography" TEXT,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "media_count" INTEGER NOT NULL DEFAULT 0,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "profile_media_key" TEXT,
    "newest_post_at" TIMESTAMPTZ(6),
    "newest_shortcode" TEXT,
    "oldest_post_at" TIMESTAMPTZ(6),
    "oldest_cursor" TEXT,
    "catalog_complete" BOOLEAN NOT NULL DEFAULT false,
    "last_scraped_at" TIMESTAMPTZ(6),
    "last_refreshed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ig_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ig_posts" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "shortcode" TEXT NOT NULL,
    "taken_at" TIMESTAMPTZ(6) NOT NULL,
    "is_video" BOOLEAN NOT NULL DEFAULT false,
    "caption" TEXT,
    "carousel_count" INTEGER NOT NULL DEFAULT 1,
    "images_ready" BOOLEAN NOT NULL DEFAULT false,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ig_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_media_key_key" ON "media_assets"("media_key");

-- CreateIndex
CREATE INDEX "media_assets_shortcode_idx" ON "media_assets"("shortcode");

-- CreateIndex
CREATE INDEX "media_assets_last_used_at_idx" ON "media_assets"("last_used_at");

-- CreateIndex
CREATE UNIQUE INDEX "ig_profiles_username_key" ON "ig_profiles"("username");

-- CreateIndex
CREATE UNIQUE INDEX "ig_profiles_ig_user_id_key" ON "ig_profiles"("ig_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ig_posts_shortcode_key" ON "ig_posts"("shortcode");

-- CreateIndex
CREATE INDEX "ig_posts_profile_id_taken_at_idx" ON "ig_posts"("profile_id", "taken_at" DESC);

-- CreateIndex
CREATE INDEX "assets_media_asset_id_idx" ON "assets"("media_asset_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "ig_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
