import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { cn } from '../utils/cn';
import { Skeleton } from './Skeleton';

export type PostPreviewItem = {
  index: number;
  shortcode: string;
  isVideo?: boolean;
  thumbnailUrl?: string | null;
  carouselCount?: number;
};

type PostPreviewListProps = {
  items: PostPreviewItem[];
  selectedIndices: number[];
  onToggleIndex: (index: number) => void;
  thumbsLoading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  tierLimited?: boolean;
  onLoadMore?: () => void;
  onShowUpgradeOverlay?: () => void;
};

type SelectionBounds = {
  top: number;
  left: number;
  width: number;
  height: number;
  count: number;
};

function formatPostCount(count: number): string {
  return count === 1 ? '1 post' : `${count} posts`;
}

function PostPreviewSelectionOverlay({ bounds }: { bounds: SelectionBounds }) {
  return (
    <div
      className="post-preview-selection-overlay pointer-events-none absolute z-20"
      style={{
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      }}
      aria-hidden
    >
      <div className="post-preview-selection-box" />
      <span className="post-preview-selection-handle post-preview-selection-handle--tl" />
      <span className="post-preview-selection-handle post-preview-selection-handle--tr" />
      <span className="post-preview-selection-handle post-preview-selection-handle--bl" />
      <span className="post-preview-selection-handle post-preview-selection-handle--br" />
      <span className="post-preview-selection-label">
        {formatPostCount(bounds.count)}
      </span>
    </div>
  );
}

function PostPreviewTile({
  item,
  selected,
  tileRef,
  onToggle,
  thumbsLoading = false,
}: {
  item: PostPreviewItem;
  selected: boolean;
  tileRef: (el: HTMLButtonElement | null) => void;
  onToggle: () => void;
  thumbsLoading?: boolean;
}) {
  const hasImage =
    typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.length > 0;
  const showThumbSkeleton = thumbsLoading && !hasImage;

  return (
    <button
      ref={tileRef}
      type="button"
      className={cn(
        'post-preview-tile relative aspect-square w-full overflow-hidden rounded-none border border-transparent bg-bg-soft-200 p-0 outline-none transition',
        'hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#0D99FE] focus-visible:ring-offset-1',
        selected && 'post-preview-tile--selected z-10',
      )}
      onClick={onToggle}
      aria-pressed={selected}
      title={`#${item.index} · ${item.shortcode}`}
    >
      {hasImage ? (
        <img src={item.thumbnailUrl!} alt="" className="h-full w-full object-cover" />
      ) : showThumbSkeleton ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-paragraph-xs font-semibold text-text-sub-600">
          {item.isVideo ? '▶' : null}
        </span>
      )}
      {item.carouselCount != null && item.carouselCount > 1 ? (
        <span className="post-preview-carousel-badge" aria-hidden>
          1/{item.carouselCount}
        </span>
      ) : null}
    </button>
  );
}

function useSelectionBounds(
  gridRef: RefObject<HTMLDivElement | null>,
  tileRefs: RefObject<Map<number, HTMLButtonElement>>,
  items: PostPreviewItem[],
  selectedIndices: number[],
) {
  const [bounds, setBounds] = useState<SelectionBounds | null>(null);

  const measure = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || selectedIndices.length === 0) {
      setBounds(null);
      return;
    }

    const selected = new Set(selectedIndices);
    const selectedElements: HTMLButtonElement[] = [];
    for (const item of items) {
      if (!selected.has(item.index)) continue;
      const el = tileRefs.current?.get(item.index);
      if (el) selectedElements.push(el);
    }

    if (selectedElements.length === 0) {
      setBounds(null);
      return;
    }

    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;

    for (const el of selectedElements) {
      const left = el.offsetLeft;
      const top = el.offsetTop;
      const right = left + el.offsetWidth;
      const bottom = top + el.offsetHeight;
      minLeft = Math.min(minLeft, left);
      minTop = Math.min(minTop, top);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    }

    setBounds({
      left: minLeft,
      top: minTop,
      width: maxRight - minLeft,
      height: maxBottom - minTop,
      count: selectedIndices.length,
    });
  }, [gridRef, tileRefs, items, selectedIndices.join(',')]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const scrollParent = grid?.closest('.post-preview-scroll');
    if (!scrollParent) return;

    const onChange = () => measure();
    scrollParent.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(onChange)
        : null;
    if (grid && observer) observer.observe(grid);

    return () => {
      scrollParent.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
      observer?.disconnect();
    };
  }, [gridRef, measure]);

  return bounds;
}

export function PostPreviewList({
  items,
  selectedIndices,
  onToggleIndex,
  thumbsLoading = false,
  hasMore = false,
  loadingMore = false,
  tierLimited = false,
  onLoadMore,
  onShowUpgradeOverlay,
}: PostPreviewListProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const selectedSet = new Set(selectedIndices);
  const selectionBounds = useSelectionBounds(
    gridRef,
    tileRefs,
    items,
    selectedIndices,
  );

  const setTileRef = useCallback((index: number, el: HTMLButtonElement | null) => {
    if (el) {
      tileRefs.current.set(index, el);
    } else {
      tileRefs.current.delete(index);
    }
  }, []);

  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  useLayoutEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useLayoutEffect(() => { onLoadMoreRef.current = onLoadMore; }, [onLoadMore]);

  // Scroll listener — set up once, reads latest values via refs.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const handleScroll = () => {
      if (!hasMoreRef.current || !onLoadMoreRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollEl;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        onLoadMoreRef.current();
      }
    };
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollEl.removeEventListener('scroll', handleScroll);
  }, []);

  // One-time check when hasMore first becomes true (content may be too short to scroll).
  const didInitialCheckRef = useRef(false);
  useEffect(() => {
    if (!hasMore) { didInitialCheckRef.current = false; return; }
    if (didInitialCheckRef.current) return;
    didInitialCheckRef.current = true;
    const scrollEl = scrollRef.current;
    if (!scrollEl || !onLoadMoreRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      onLoadMoreRef.current();
    }
  }, [hasMore]);

  if (items.length === 0) return null;

  return (
    <div className="post-preview-panel flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="post-preview-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <div ref={gridRef} className="post-preview-grid relative">
          {items.map((item) => (
            <PostPreviewTile
              key={item.shortcode}
              item={item}
              selected={selectedSet.has(item.index)}
              tileRef={(el) => setTileRef(item.index, el)}
              onToggle={() => onToggleIndex(item.index)}
              thumbsLoading={thumbsLoading}
            />
          ))}
          {selectionBounds ? (
            <PostPreviewSelectionOverlay bounds={selectionBounds} />
          ) : null}
        </div>
        {loadingMore ? (
          <div className="flex items-center justify-center py-4">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-40" />
          </div>
        ) : null}
        {tierLimited ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-paragraph-xs text-text-sub-600">Upgrade to preview more posts</p>
            <button
              type="button"
              className="text-paragraph-xs font-medium text-[#0D99FE] hover:underline"
              onClick={onShowUpgradeOverlay}
            >
              See upgrade options
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
