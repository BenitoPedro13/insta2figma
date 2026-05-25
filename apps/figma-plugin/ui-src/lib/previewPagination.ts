export const PREVIEW_PAGE_SIZE = 12;
export const FREE_MAX_PREVIEW_PAGE = 3;

export function buildPreviewPageNumbers(input: {
  planTier: 'free' | 'pro';
  currentPage: number;
  pagesLoaded: number;
  hasNextPage: boolean;
}): number[] {
  if (input.planTier === 'free') {
    const pages = [1, 2, 3];
    if (input.hasNextPage) pages.push(4);
    return pages;
  }

  const lastKnown = Math.max(input.pagesLoaded, input.currentPage);
  const total = input.hasNextPage ? lastKnown + 1 : lastKnown;
  return Array.from({ length: Math.max(1, total) }, (_, i) => i + 1);
}

export function isPreviewPageLocked(
  planTier: 'free' | 'pro',
  page: number,
): boolean {
  return planTier === 'free' && page > FREE_MAX_PREVIEW_PAGE;
}
