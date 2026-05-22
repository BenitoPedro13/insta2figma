import { cn } from '../utils/cn';

type AccountBadgeProps = {
  planTier: 'free' | 'pro';
  className?: string;
};

/** Pill FREE/PRO ao lado da logo — Figma node 652:2328 (40×16). */
export function AccountBadge({ planTier, className }: AccountBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
        planTier === 'pro'
          ? 'bg-feature-lighter text-feature-dark'
          : 'bg-success-lighter text-success-dark',
        className,
      )}
    >
      {planTier === 'pro' ? 'Pro' : 'Free'}
    </span>
  );
}
