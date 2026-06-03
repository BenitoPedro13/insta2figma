import { buildIndexedPostPreview, PREVIEW_PAGE_SIZE } from '@insta2figma/shared-contracts';
import { fetchPreviewViaApify, type ApifyPreviewConfig, type ApifyPreviewProfile } from './apify-preview.client';
import { fetchInstagramImageAsDataUrl } from './instagram-image.utils';
import type { CachedPreviewPayload, PreviewDataSource } from './preview-source.types';

const MAX_AVATAR_BYTES = 900_000;

export class ApifyPreviewSource implements PreviewDataSource {
  readonly name = 'apify';

  constructor(private readonly config: ApifyPreviewConfig) {}

  async fetchPreview(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<CachedPreviewPayload> {
    const apify = await fetchPreviewViaApify(this.config, username, fetchCount);
    return this.buildCachedPreview(apify, fetchCount, timelineOrder);
  }

  private async buildCachedPreview(
    apify: ApifyPreviewProfile,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<CachedPreviewPayload> {
    const pageOnePosts = apify.parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
    const postsPreview = buildIndexedPostPreview(pageOnePosts, timelineOrder, { indexStart: 1 });

    let profilePicDataUrl: string | null = null;
    if (apify.profilePicUrlHd) {
      profilePicDataUrl = await fetchInstagramImageAsDataUrl(apify.profilePicUrlHd, MAX_AVATAR_BYTES);
    }

    // When mediaCount is 0 (post-scraper actor doesn't return profile metadata), derive
    // pagination from the number of posts actually fetched.
    const gotAllAvailable = apify.parsedPosts.length < fetchCount;
    const estimatedTotal =
      apify.mediaCount > 0
        ? apify.mediaCount
        : gotAllAvailable
          ? apify.parsedPosts.length
          : apify.parsedPosts.length + PREVIEW_PAGE_SIZE; // at least one more page worth

    const previewTotalPages = Math.max(1, Math.ceil(estimatedTotal / PREVIEW_PAGE_SIZE));
    const hasNextPreviewPage =
      apify.parsedPosts.length > PREVIEW_PAGE_SIZE ||
      (apify.mediaCount > 0 && apify.mediaCount > PREVIEW_PAGE_SIZE) ||
      (apify.mediaCount === 0 && !gotAllAvailable);

    return {
      username: apify.username,
      instagramUserId: apify.instagramUserId,
      profilePicUrlHd: apify.profilePicUrlHd,
      profilePicDataUrl,
      mediaCount: apify.mediaCount,
      isPrivate: apify.isPrivate,
      parsedPosts: apify.parsedPosts,
      postsPreview,
      postsAvailable: apify.parsedPosts.length,
      timelineOrder,
      hasNextPreviewPage,
      nextPreviewCursor: null,
      previewTotalPages,
    };
  }
}
