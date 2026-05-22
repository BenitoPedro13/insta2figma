import { cn } from '../utils/cn';

export type PostPreviewItem = {
  index: number;
  shortcode: string;
  isVideo?: boolean;
  thumbnailUrl?: string | null;
  carouselCount?: number;
};

type PostPreviewListProps = {
  items: PostPreviewItem[];
  timelineOrder: 'newest_first' | 'oldest_first';
  selectionMode: 'recent' | 'single' | 'range';
  startIndex: number;
  postCount: number;
  postsAvailable: number;
  selectionWarning?: string;
  onSelectIndex: (index: number) => void;
};

function formatOrderLabel(order: 'newest_first' | 'oldest_first'): string {
  return order === 'newest_first' ? 'newest → oldest' : 'oldest → newest';
}

function isIndexSelected(
  index: number,
  mode: PostPreviewListProps['selectionMode'],
  startIndex: number,
  postCount: number,
): boolean {
  if (mode === 'recent') return index <= postCount;
  if (mode === 'single') return index === startIndex;
  return index >= startIndex && index < startIndex + postCount;
}

function PostPreviewTile({
  item,
  selected,
  onSelect,
}: {
  item: PostPreviewItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const hasImage =
    typeof item.thumbnailUrl === 'string' && item.thumbnailUrl.length > 0;

  return (
    <button
      type="button"
      className={cn(
        'post-preview-tile relative aspect-square w-full overflow-hidden rounded-none border-2 border-transparent bg-bg-soft-200 p-0 outline-none transition',
        'hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary-base focus-visible:ring-offset-1',
        selected && 'post-preview-tile--selected z-10 border-static-white shadow-[0_0_0_1px_var(--color-static-white)]',
      )}
      onClick={onSelect}
      title={`#${item.index} · ${item.shortcode}`}
    >
      {hasImage ? (
        <img src={item.thumbnailUrl!} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-paragraph-xs font-semibold text-text-sub-600">
          {item.isVideo ? '▶' : '#'}
          {item.index}
        </span>
      )}
      <span className="absolute bottom-1 left-1 rounded-none bg-overlay-gray px-1 py-px text-[10px] font-semibold leading-tight text-text-white-0">
        #{item.index}
      </span>
      {item.carouselCount != null && item.carouselCount > 1 ? (
        <span className="absolute right-1 top-1 rounded-none bg-bg-white-0 px-1 py-px text-[9px] font-semibold text-text-sub-600">
          {item.carouselCount}
        </span>
      ) : null}
    </button>
  );
}

export function PostPreviewList({
  items,
  timelineOrder,
  selectionMode,
  startIndex,
  postCount,
  postsAvailable,
  selectionWarning,
  onSelectIndex,
}: PostPreviewListProps) {
  if (items.length === 0) return null;

  return (
    <div className="post-preview-panel flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <p className="m-0 text-label-sm font-semibold text-text-strong-950">Post preview</p>
        <p className="mt-1 text-paragraph-xs text-text-sub-600">
          Order: {formatOrderLabel(timelineOrder)} · {postsAvailable} visible. Click a tile to
          pick a position.
        </p>
        {selectionWarning ? (
          <p className="mt-1 text-paragraph-xs text-warning-dark">{selectionWarning}</p>
        ) : null}
      </div>
      <div className="post-preview-grid min-h-0 flex-1 overflow-y-auto p-3 pt-2">
        {items.map((item) => (
          <PostPreviewTile
            key={item.shortcode}
            item={item}
            selected={isIndexSelected(
              item.index,
              selectionMode,
              startIndex,
              postCount,
            )}
            onSelect={() => onSelectIndex(item.index)}
          />
        ))}
      </div>
    </div>
  );
}
