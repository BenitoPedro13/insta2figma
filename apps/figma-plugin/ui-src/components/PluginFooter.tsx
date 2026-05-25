import { RiFlashlightFill, RiTimeLine } from '@remixicon/react';

type PluginFooterProps = {
  planTier: 'free' | 'pro';
  jobsRemaining: number | null;
  jobsLimit: number | null;
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
      aria-label={`${Math.round(usedPct)}% of monthly import quota used`}
    >
      <circle
        cx={center}
        cy={center}
        r={QUOTA_RING_RADIUS}
        fill="none"
        stroke="var(--color-stroke-soft-200)"
        strokeWidth={QUOTA_RING_STROKE}
      />
      {arcLength > 0 ? (
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
      ) : null}
    </svg>
  );
}

function daysUntilReset(periodEndIso: string | null): number {
  const end = periodEndIso
    ? new Date(periodEndIso)
    : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1);
  const ms = end.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function PluginFooter({
  planTier,
  jobsRemaining,
  jobsLimit,
  periodEndIso,
  onUpgrade,
}: PluginFooterProps) {
  const days = daysUntilReset(periodEndIso);
  const used =
    jobsLimit != null && jobsRemaining != null
      ? Math.max(0, jobsLimit - jobsRemaining)
      : null;

  const quotaLabel =
    used != null && jobsLimit != null
      ? `${used}/${jobsLimit} images imported`
      : planTier === 'pro'
        ? 'Unlimited imports'
        : 'Import quota';

  return (
    <footer className="plugin-footer flex h-[var(--plugin-footer-height)] shrink-0 items-center justify-center border-t border-stroke-soft-200 bg-bg-white-0 px-4">
      <div className="flex flex-wrap items-center justify-center gap-1">
        <div className="flex items-center gap-1.5">
          {used != null && jobsLimit != null && jobsLimit > 0 ? (
            <QuotaRing used={used} limit={jobsLimit} />
          ) : null}
          <span className="text-label-sm font-medium text-text-sub-600">{quotaLabel}</span>
        </div>
        <RiTimeLine className="size-6 shrink-0 text-text-sub-600" aria-hidden />
        <span className="text-label-sm font-medium text-text-sub-600">
          Resets in {days} {days === 1 ? 'day' : 'days'}
        </span>
        {planTier === 'free' ? (
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
        ) : null}
      </div>
    </footer>
  );
}
