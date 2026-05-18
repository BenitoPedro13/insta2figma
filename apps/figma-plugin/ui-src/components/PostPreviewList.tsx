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
  return order === 'newest_first' ? 'mais recente → mais antigo' : 'mais antigo → mais recente';
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
      className={`post-preview-tile${selected ? ' post-preview-tile--selected' : ''}`}
      onClick={onSelect}
      title={`#${item.index} · ${item.shortcode}`}
    >
      {hasImage ? (
        <img src={item.thumbnailUrl!} alt="" className="post-preview-tile-img" />
      ) : (
        <span className="post-preview-tile-placeholder">
          {item.isVideo ? '▶' : '#'}
          {item.index}
        </span>
      )}
      <span className="post-preview-tile-index">#{item.index}</span>
      {item.carouselCount != null && item.carouselCount > 1 ? (
        <span className="post-preview-tile-badge">{item.carouselCount}</span>
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
    <div className="post-preview-panel">
      <div className="import-section-label">Preview dos posts</div>
      <p className="import-hint">
        Ordem: {formatOrderLabel(timelineOrder)} · {postsAvailable} visível(is). Clica numa
        imagem para escolher a posição.
      </p>
      {selectionWarning ? (
        <p className="import-hint import-hint--warn">{selectionWarning}</p>
      ) : null}
      <div className="post-preview-grid">
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
