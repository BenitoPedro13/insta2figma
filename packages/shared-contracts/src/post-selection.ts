export const POST_TIMELINE_ORDERS = ['newest_first', 'oldest_first'] as const;
export type PostTimelineOrder = (typeof POST_TIMELINE_ORDERS)[number];

export const POST_SELECTION_MODES = ['recent', 'single', 'range', 'multi'] as const;
export type PostSelectionMode = (typeof POST_SELECTION_MODES)[number];

export type ScrapeSelectionInput = {
  maxPosts?: number;
  selectionMode?: PostSelectionMode;
  startIndex?: number;
  postCount?: number;
  timelineOrder?: PostTimelineOrder;
  /** Posições 1-based escolhidas individualmente (modo `multi`). */
  selectedIndices?: number[];
};

export type ResolvedScrapeSelection = {
  mode: PostSelectionMode;
  timelineOrder: PostTimelineOrder;
  /** Posição 1-based na ordem escolhida. */
  startIndex: number;
  postCount: number;
  /** Quantos posts pedir ao Instagram (cobre startIndex + postCount). */
  fetchCount: number;
  selectedIndices?: number[];
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

export function normalizeSelectedIndices(indices: number[] | undefined): number[] {
  if (!indices?.length) return [];
  return [...new Set(indices.map((i) => clampInt(i, 1, ABSOLUTE_MAX)))].sort(
    (a, b) => a - b,
  );
}

export function buildContiguousIndices(start: number, count: number): number[] {
  const safeStart = clampInt(start, 1, ABSOLUTE_MAX);
  const safeCount = clampInt(count, 0, ABSOLUTE_MAX);
  if (safeCount < 1) return [];
  return Array.from({ length: safeCount }, (_, i) => safeStart + i);
}

export function toggleSelectedIndex(indices: number[], index: number): number[] {
  const next = new Set(normalizeSelectedIndices(indices));
  const key = clampInt(index, 1, ABSOLUTE_MAX);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return [...next].sort((a, b) => a - b);
}

function isContiguous(sorted: number[]): boolean {
  return sorted.every((value, idx) => idx === 0 || value === sorted[idx - 1] + 1);
}

/** Converte índices escolhidos na UI para input de scrape/API. */
export function selectionInputFromIndices(
  indices: number[],
  opts?: { rangeMode?: boolean; timelineOrder?: PostTimelineOrder },
): ScrapeSelectionInput {
  const sorted = normalizeSelectedIndices(indices);
  const timelineOrder = opts?.timelineOrder ?? 'newest_first';
  if (sorted.length === 0) {
    return { maxPosts: 0, selectionMode: 'recent', timelineOrder };
  }

  const end = sorted[sorted.length - 1]!;
  if (opts?.rangeMode && isContiguous(sorted)) {
    return {
      selectionMode: 'range',
      startIndex: sorted[0],
      postCount: sorted.length,
      maxPosts: end,
      timelineOrder,
    };
  }

  if (isContiguous(sorted) && sorted[0] === 1) {
    return {
      selectionMode: 'recent',
      maxPosts: sorted.length,
      timelineOrder,
    };
  }

  if (isContiguous(sorted)) {
    return {
      selectionMode: 'range',
      startIndex: sorted[0],
      postCount: sorted.length,
      maxPosts: end,
      timelineOrder,
    };
  }

  return {
    selectionMode: 'multi',
    selectedIndices: sorted,
    startIndex: sorted[0],
    postCount: sorted.length,
    maxPosts: end,
    timelineOrder,
  };
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

  if (mode === 'multi') {
    const selectedIndices = normalizeSelectedIndices(input.selectedIndices);
    if (selectedIndices.length === 0) {
      return {
        mode,
        timelineOrder,
        startIndex: 1,
        postCount: 0,
        fetchCount: 1,
        selectedIndices: [],
      };
    }
    const fetchCount = selectedIndices[selectedIndices.length - 1]!;
    return {
      mode,
      timelineOrder,
      startIndex: selectedIndices[0]!,
      postCount: selectedIndices.length,
      fetchCount,
      selectedIndices,
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
  if (selection.mode === 'multi') {
    const indices = selection.selectedIndices ?? [];
    return indices
      .map((index) => ordered[index - 1])
      .filter((item): item is T => item !== undefined);
  }
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
  if (selection.mode === 'multi') {
    const indices = selection.selectedIndices ?? [];
    if (indices.length === 0) return 0;
    return Math.max(...indices);
  }
  return selection.startIndex + selection.postCount - 1;
}
