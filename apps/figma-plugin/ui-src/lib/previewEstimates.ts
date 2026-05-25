import {
  endSelectionIndex,
  estimateImportImages,
  resolveScrapeSelection,
  type PostSelectionMode,
  type PostTimelineOrder,
} from '@insta2figma/shared-contracts';

export type PreviewPostForEstimate = {
  shortcode: string;
  carouselCount?: number;
};

export type PreviewEstimateInput = {
  maxPosts: number;
  selectionMode: PostSelectionMode;
  startIndex: number;
  postCount: number;
  timelineOrder: PostTimelineOrder;
  expandCarouselImages: boolean;
  postsAvailable?: number;
};

function buildEstimateItems(posts: PreviewPostForEstimate[]) {
  return posts.map((p) => ({
    shortcode: p.shortcode,
    carouselImageUrls:
      p.carouselCount != null && p.carouselCount > 1
        ? Array.from({ length: p.carouselCount - 1 }, () => '')
        : undefined,
  }));
}

export function computePreviewEstimates(
  postsPreview: PreviewPostForEstimate[] | undefined,
  input: PreviewEstimateInput,
): {
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  selectionWarning?: string;
} {
  const empty = {
    estimatedImportImages: 0,
    estimatedPostCovers: 0,
    estimatedCarouselExtras: 0,
  };

  if (input.selectionMode === 'recent' && input.maxPosts < 1) {
    return empty;
  }
  if (input.selectionMode === 'range' && input.postCount < 1) {
    return empty;
  }

  const items = buildEstimateItems(postsPreview ?? []);
  const selection = resolveScrapeSelection({
    maxPosts: Math.max(1, input.maxPosts),
    selectionMode: input.selectionMode,
    startIndex: input.startIndex,
    postCount: input.postCount,
    timelineOrder: input.timelineOrder,
  });

  const estimate = estimateImportImages(
    items,
    selection,
    input.expandCarouselImages,
  );

  const selectionEndIndex = endSelectionIndex(selection);
  const available = input.postsAvailable ?? items.length;
  let selectionWarning: string | undefined;
  if (selectionEndIndex > available) {
    selectionWarning = `Only ${available} post(s) visible in preview. Position #${selectionEndIndex} may require loading more posts.`;
  }

  return {
    ...estimate,
    ...(selectionWarning ? { selectionWarning } : {}),
  };
}
