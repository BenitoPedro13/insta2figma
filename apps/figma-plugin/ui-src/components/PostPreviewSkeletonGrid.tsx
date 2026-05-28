import { Skeleton } from './Skeleton';

type PostPreviewSkeletonGridProps = {
  count?: number;
};

export function PostPreviewSkeletonGrid({ count = 12 }: PostPreviewSkeletonGridProps) {
  const tiles = Math.max(1, Math.min(50, Math.floor(count)));

  return (
    <div className="post-preview-panel flex h-full min-h-0 flex-col">
      <div className="post-preview-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <div className="post-preview-grid">
          {Array.from({ length: tiles }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
