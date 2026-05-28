export const FREE_MAX_PREVIEW_PAGE = 3;
export const PRO_MAX_PREVIEW_PAGE = 12;

export function maxAccessiblePreviewPage(
  planTier: 'free' | 'pro' | 'max',
  totalPages: number,
): number {
  const safeTotal = Math.max(1, Math.floor(totalPages));
  if (planTier === 'max') return safeTotal;
  if (planTier === 'pro') {
    return Math.min(safeTotal, PRO_MAX_PREVIEW_PAGE);
  }
  return Math.min(safeTotal, FREE_MAX_PREVIEW_PAGE);
}
