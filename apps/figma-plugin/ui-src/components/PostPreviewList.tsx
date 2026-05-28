import {
  useCallback,
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
}: PostPreviewListProps) {
  const gridRef = useRef<HTMLDivElement>(null);
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

  if (items.length === 0) return null;

  return (
    <div className="post-preview-panel flex h-full min-h-0 flex-col">
      <div className="post-preview-scroll min-h-0 flex-1 overflow-y-auto p-3">
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
      </div>
    </div>
  );
}
