import { cn } from '../utils/cn';

type ProfilePreviewMorseSkeletonProps = {
  className?: string;
  compact?: boolean;
};

/** Lazy pulse pattern: - — - — */
export function ProfilePreviewMorseSkeleton({
  className,
  compact = false,
}: ProfilePreviewMorseSkeletonProps) {
  return (
    <span
      className={cn(
        'profile-preview-morse-skeleton',
        compact && 'profile-preview-morse-skeleton--compact',
        className,
      )}
      aria-hidden
    >
      <span className="profile-preview-morse-mark profile-preview-morse-mark--short" />
      <span className="profile-preview-morse-mark profile-preview-morse-mark--long" />
      <span className="profile-preview-morse-mark profile-preview-morse-mark--short" />
      <span className="profile-preview-morse-mark profile-preview-morse-mark--long" />
    </span>
  );
}
