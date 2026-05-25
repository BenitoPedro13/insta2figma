import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import * as Pagination from './ui/pagination';
import {
  buildPreviewPageNumbers,
  isPreviewPageLocked,
} from '../lib/previewPagination';

type PostPreviewPaginationProps = {
  planTier: 'free' | 'pro';
  currentPage: number;
  pagesLoaded: number;
  hasNextPage: boolean;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  onUpgradeRequired: () => void;
};

export function PostPreviewPagination({
  planTier,
  currentPage,
  pagesLoaded,
  hasNextPage,
  disabled = false,
  onPageChange,
  onUpgradeRequired,
}: PostPreviewPaginationProps) {
  const pageNumbers = buildPreviewPageNumbers({
    planTier,
    currentPage,
    pagesLoaded,
    hasNextPage,
  });

  const tryPage = (page: number) => {
    if (disabled) return;
    if (isPreviewPageLocked(planTier, page)) {
      onUpgradeRequired();
      return;
    }
    onPageChange(page);
  };

  const prevPage = currentPage - 1;
  const nextPage = currentPage + 1;
  const canPrev = currentPage > 1 && !disabled;
  const canNext = hasNextPage && !disabled;

  return (
    <div className="post-preview-pagination flex shrink-0 justify-center border-t border-stroke-soft-200 bg-bg-white-0 px-3 py-3">
      <Pagination.Root variant="group" aria-label="Preview pagination">
        <Pagination.NavButton
          type="button"
          aria-label="Previous page"
          disabled={!canPrev}
          onClick={() => {
            if (!canPrev) return;
            tryPage(prevPage);
          }}
        >
          <Pagination.NavIcon as={RiArrowLeftSLine} aria-hidden />
        </Pagination.NavButton>

        {pageNumbers.map((page) => (
          <Pagination.Item
            key={page}
            type="button"
            current={page === currentPage}
            onClick={() => tryPage(page)}
          >
            {page}
          </Pagination.Item>
        ))}

        <Pagination.NavButton
          type="button"
          aria-label="Next page"
          disabled={!canNext}
          onClick={() => {
            if (!canNext) return;
            tryPage(nextPage);
          }}
        >
          <Pagination.NavIcon as={RiArrowRightSLine} aria-hidden />
        </Pagination.NavButton>
      </Pagination.Root>
    </div>
  );
}
