export const POST_TIMELINE_ORDERS = ['newest_first', 'oldest_first'] as const;
export type PostTimelineOrder = (typeof POST_TIMELINE_ORDERS)[number];

export const POST_SELECTION_MODES = ['recent', 'single', 'range'] as const;
export type PostSelectionMode = (typeof POST_SELECTION_MODES)[number];

export type ScrapeSelectionInput = {
  maxPosts?: number;
  selectionMode?: PostSelectionMode;
  startIndex?: number;
  postCount?: number;
  timelineOrder?: PostTimelineOrder;
};

export type ResolvedScrapeSelection = {
  mode: PostSelectionMode;
  timelineOrder: PostTimelineOrder;
  /** Posição 1-based na ordem escolhida. */
  startIndex: number;
  postCount: number;
  /** Quantos posts pedir ao Instagram (cobre startIndex + postCount). */
  fetchCount: number;
};

export type ImportImageEstimate = {
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  estimatedImportImages: number;
};

export type CarouselPostEstimate = {
  shortcode: string;
  carouselImageUrls?: string[];
};

const ABSOLUTE_MAX = 50;

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** Normaliza opções de seleção com defaults compatíveis com imports antigos (`recent`). */
export function resolveScrapeSelection(
  input: ScrapeSelectionInput,
  defaults?: { defaultMaxPosts?: number },
): ResolvedScrapeSelection {
  const mode = input.selectionMode ?? 'recent';
  const timelineOrder = input.timelineOrder ?? 'newest_first';

  if (mode === 'recent') {
    const postCount = clampInt(
      input.maxPosts ?? defaults?.defaultMaxPosts ?? 12,
      1,
      ABSOLUTE_MAX,
    );
    return {
      mode,
      timelineOrder,
      startIndex: 1,
      postCount,
      fetchCount: postCount,
    };
  }

  const startIndex = clampInt(input.startIndex ?? 1, 1, ABSOLUTE_MAX);
  const postCount =
    mode === 'single'
      ? 1
      : clampInt(input.postCount ?? 1, 1, ABSOLUTE_MAX);
  const fetchCount = clampInt(startIndex + postCount - 1, 1, ABSOLUTE_MAX);

  return { mode, timelineOrder, startIndex, postCount, fetchCount };
}

export function orderTimelinePosts<T>(
  items: T[],
  timelineOrder: PostTimelineOrder,
): T[] {
  return timelineOrder === 'oldest_first' ? [...items].reverse() : items;
}

export function slicePostsBySelection<T>(
  items: T[],
  selection: ResolvedScrapeSelection,
): T[] {
  const ordered = orderTimelinePosts(items, selection.timelineOrder);
  const start = selection.startIndex - 1;
  return ordered.slice(start, start + selection.postCount);
}

export function estimateImportImages(
  items: CarouselPostEstimate[],
  selection: ResolvedScrapeSelection,
  expandCarousel: boolean,
): ImportImageEstimate {
  const selected = slicePostsBySelection(items, selection);
  let estimatedPostCovers = 0;
  let estimatedCarouselExtras = 0;
  for (const post of selected) {
    estimatedPostCovers += 1;
    if (!expandCarousel) continue;
    const sidecar = post.carouselImageUrls?.length ?? 0;
    estimatedCarouselExtras += Math.max(0, sidecar);
  }
  return {
    estimatedPostCovers,
    estimatedCarouselExtras,
    estimatedImportImages: estimatedPostCovers + estimatedCarouselExtras,
  };
}

export function endSelectionIndex(selection: ResolvedScrapeSelection): number {
  return selection.startIndex + selection.postCount - 1;
}
