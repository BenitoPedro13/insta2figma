import type {
  InstagramPostPreviewItem,
  InstagramPostSummaryItem,
} from '@insta2figma/shared-contracts';

export type CachedPreviewPayload = {
  username: string;
  instagramUserId: string | null;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  parsedPosts: InstagramPostSummaryItem[];
  postsPreview: InstagramPostPreviewItem[];
  postsAvailable: number;
  timelineOrder: 'newest_first' | 'oldest_first';
  hasNextPreviewPage: boolean;
  nextPreviewCursor: string | null;
  previewTotalPages: number;
};

export type TelemetryCtx = {
  callerUserId: string | null;
  planTier: string | null;
};

export interface PreviewDataSource {
  readonly name: string;
  fetchPreview(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
    ctx?: TelemetryCtx,
  ): Promise<CachedPreviewPayload>;
}
