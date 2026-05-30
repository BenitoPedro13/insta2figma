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
    return this.buildCachedPreview(apify, timelineOrder);
  }

  private async buildCachedPreview(
    apify: ApifyPreviewProfile,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<CachedPreviewPayload> {
    const pageOnePosts = apify.parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
    const postsPreview = buildIndexedPostPreview(pageOnePosts, timelineOrder, { indexStart: 1 });

    let profilePicDataUrl: string | null = null;
    if (apify.profilePicUrlHd) {
      profilePicDataUrl = await fetchInstagramImageAsDataUrl(apify.profilePicUrlHd, MAX_AVATAR_BYTES);
    }

    const previewTotalPages = Math.max(1, Math.ceil(apify.mediaCount / PREVIEW_PAGE_SIZE));
    const hasNextPreviewPage =
      apify.parsedPosts.length > PREVIEW_PAGE_SIZE || apify.mediaCount > PREVIEW_PAGE_SIZE;

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
