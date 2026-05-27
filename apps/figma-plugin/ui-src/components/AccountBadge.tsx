import { cn } from '../utils/cn';
import { planTierLabel, type PlanTier } from '../lib/planTier';

type AccountBadgeProps = {
  planTier: PlanTier;
  className?: string;
};

/** Pill FREE/PRO/MAX ao lado da logo — Figma node 652:2328 (40×16). */
export function AccountBadge({ planTier, className }: AccountBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center justify-center rounded px-1.5 text-[10px] font-semibold uppercase leading-none tracking-wide',
        planTier === 'max'
          ? 'bg-warning-lighter text-warning-dark'
          : planTier === 'pro'
            ? 'bg-feature-lighter text-feature-dark'
            : 'bg-success-lighter text-success-dark',
        className,
      )}
    >
      {planTierLabel(planTier)}
    </span>
  );
}
