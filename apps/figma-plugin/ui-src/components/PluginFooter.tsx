import { RiFlashlightFill, RiTimeLine } from '@remixicon/react';

type PluginFooterProps = {
  planTier: 'free' | 'pro';
  jobsRemaining: number | null;
  jobsLimit: number | null;
  periodEndIso: string | null;
  onUpgrade: () => void;
};

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
        <span className="text-label-xs font-medium text-text-sub-600">{quotaLabel}</span>
        <RiTimeLine className="size-4 shrink-0 text-text-sub-600" aria-hidden />
        <span className="text-label-xs font-medium text-text-sub-600">
          Resets in {days} {days === 1 ? 'day' : 'days'}
        </span>
        {planTier === 'free' ? (
          <>
            <RiFlashlightFill className="size-4 shrink-0 text-text-sub-600" aria-hidden />
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-label-xs font-medium text-text-strong-950 transition hover:text-feature-base"
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
