import { RiFlashlightFill, RiTimeLine } from '@remixicon/react';
import { isPaidPlan, planTierLabel, type PlanTier } from '../lib/planTier';

type PluginFooterProps = {
  planTier: PlanTier;
  imagesRemaining: number | null;
  imagesLimit: number | null;
  periodEndIso: string | null;
  onUpgrade: () => void;
};

const QUOTA_RING_SIZE = 24;
const QUOTA_RING_STROKE = 2.5;
const QUOTA_RING_RADIUS = (QUOTA_RING_SIZE - QUOTA_RING_STROKE) / 2;
const QUOTA_RING_CIRCUMFERENCE = 2 * Math.PI * QUOTA_RING_RADIUS;

function quotaRingColor(usedPct: number): string {
  if (usedPct >= 90) return 'var(--color-error-base)';
  if (usedPct >= 60) return 'var(--color-yellow-500)';
  return '#0D99FE';
}

function QuotaRing({
  used,
  limit,
}: {
  used: number;
  limit: number;
}) {
  const safeLimit = Math.max(1, limit);
  const safeUsed = Math.max(0, Math.min(used, safeLimit));
  const usedPct = (safeUsed / safeLimit) * 100;
  const usedRatio = safeUsed / safeLimit;
  const arcLength = usedRatio * QUOTA_RING_CIRCUMFERENCE;
  const color = quotaRingColor(usedPct);
  const center = QUOTA_RING_SIZE / 2;

  return (
    <svg
      width={QUOTA_RING_SIZE}
      height={QUOTA_RING_SIZE}
      viewBox={`0 0 ${QUOTA_RING_SIZE} ${QUOTA_RING_SIZE}`}
      className="size-6 shrink-0"
      role="img"
      aria-label={`${Math.round(usedPct)}% of quota period used`}
    >
      <circle
        cx={center}
        cy={center}
        r={QUOTA_RING_RADIUS}
        fill="none"
        stroke="var(--color-stroke-soft-200)"
        strokeWidth={QUOTA_RING_STROKE}
      />
      <circle
        cx={center}
        cy={center}
        r={QUOTA_RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={QUOTA_RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${arcLength} ${QUOTA_RING_CIRCUMFERENCE}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  );
}

function daysUntilReset(periodEndIso: string | null): number | null {
  if (!periodEndIso) return null;
  const end = new Date(periodEndIso);
  const ms = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function defaultQuotaLabel(planTier: PlanTier): string {
  if (planTier === 'max') return '100,000 images / 30 days';
  if (planTier === 'pro') return '10,000 images / 30 days';
  return '100 images / 30 days';
}

export function PluginFooter({
  planTier,
  imagesRemaining,
  imagesLimit,
  periodEndIso,
  onUpgrade,
}: PluginFooterProps) {
  const days = daysUntilReset(periodEndIso);
  const used =
    imagesLimit != null && imagesRemaining != null
      ? Math.max(0, imagesLimit - imagesRemaining)
      : null;

  const quotaLabel =
    used != null && imagesLimit != null
      ? `${used}/${imagesLimit} images this period`
      : defaultQuotaLabel(planTier);

  return (
    <footer className="plugin-footer flex h-[--plugin-footer-height] shrink-0 items-center justify-center border-t border-stroke-soft-200 bg-bg-white-0 px-4">
      <div className="flex flex-wrap items-center justify-center gap-1">
        <div className="flex items-center gap-1.5">
          {used != null && imagesLimit != null && imagesLimit > 0 ? (
            <QuotaRing used={used} limit={imagesLimit} />
          ) : null}
          <span className="text-label-sm font-medium text-text-sub-600">{quotaLabel}</span>
        </div>
        {days != null ? (
          <>
            <RiTimeLine className="size-6 shrink-0 text-text-sub-600" aria-hidden />
            <span className="text-label-sm font-medium text-text-sub-600">
              Resets in {days} {days === 1 ? 'day' : 'days'}
            </span>
          </>
        ) : null}
        {!isPaidPlan(planTier) ? (
          <>
            <RiFlashlightFill className="size-6 shrink-0 text-text-sub-600" aria-hidden />
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-label-sm font-medium text-text-strong-950 transition hover:text-feature-base"
              onClick={onUpgrade}
            >
              Upgrade
            </button>
          </>
        ) : planTier === 'pro' ? (
          <>
            <RiFlashlightFill className="size-6 shrink-0 text-text-sub-600" aria-hidden />
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-label-sm font-medium text-text-strong-950 transition hover:text-feature-base"
              onClick={onUpgrade}
            >
              Upgrade to Max
            </button>
          </>
        ) : null}
      </div>
    </footer>
  );
}
