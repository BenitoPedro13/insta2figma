import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import * as Pagination from './ui/pagination';

type PostPreviewPaginationProps = {
  currentPage: number;
  totalPages: number;
  maxAccessiblePage: number;
  onPageChange: (page: number) => void;
  onBlockedAdvance: () => void;
};

function buildVisiblePages(current: number, total: number): number[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, total, current]);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  return [...pages].sort((a, b) => a - b);
}

export function PostPreviewPagination({
  currentPage,
  totalPages,
  maxAccessiblePage,
  onPageChange,
  onBlockedAdvance,
}: PostPreviewPaginationProps) {
  if (totalPages <= 1) return null;

  const visiblePages = buildVisiblePages(currentPage, totalPages);

  const tryPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    if (page > maxAccessiblePage) {
      onBlockedAdvance();
      return;
    }
    onPageChange(page);
  };

  const tryNext = () => {
    if (currentPage >= totalPages) return;
    if (currentPage + 1 > maxAccessiblePage) {
      onBlockedAdvance();
      return;
    }
    onPageChange(currentPage + 1);
  };

  return (
    <div className="post-preview-pagination shrink-0 border-t border-stroke-soft-200 bg-bg-white-0">
      <Pagination.Root
        variant="group"
        className="post-preview-pagination-root w-full !divide-x-0 !rounded-none !border-0"
        aria-label="Post preview pages"
      >
        <Pagination.NavButton
          type="button"
          className="post-preview-pagination-cell"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => tryPage(currentPage - 1)}
        >
          <Pagination.NavIcon as={RiArrowLeftSLine} />
        </Pagination.NavButton>

        {visiblePages.map((page, index) => {
          const prev = visiblePages[index - 1];
          const showGap = prev != null && page - prev > 1;

          return (
            <span key={page} className="contents">
              {showGap ? (
                <span
                  className="post-preview-pagination-cell flex h-8 min-w-10 items-center justify-center text-label-sm text-text-soft-400"
                  aria-hidden
                >
                  …
                </span>
              ) : null}
              <Pagination.Item
                type="button"
                className="post-preview-pagination-cell"
                current={page === currentPage}
                aria-label={`Page ${page}`}
                aria-current={page === currentPage ? 'page' : undefined}
                onClick={() => tryPage(page)}
              >
                {page}
              </Pagination.Item>
            </span>
          );
        })}

        <Pagination.NavButton
          type="button"
          className="post-preview-pagination-cell"
          aria-label="Next page"
          disabled={currentPage >= totalPages}
          onClick={tryNext}
        >
          <Pagination.NavIcon as={RiArrowRightSLine} />
        </Pagination.NavButton>
      </Pagination.Root>
    </div>
  );
}
