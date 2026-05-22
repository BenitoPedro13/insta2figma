import { cn } from '../utils/cn';

type AccountBannerProps = {
  planTier: 'free' | 'pro';
  jobsRemaining: number | null;
  jobsLimit: number | null;
  sessionError: string;
  onUpgrade: () => void;
  onManage: () => void;
};

export function AccountBanner({
  planTier,
  jobsRemaining,
  jobsLimit,
  sessionError,
  onUpgrade,
  onManage,
}: AccountBannerProps) {
  if (sessionError) {
    return (
      <div className="account-banner flex shrink-0 items-center justify-between gap-2 border-b border-stroke-soft-200 bg-error-lighter px-3 py-2">
        <p className="m-0 text-paragraph-xs text-error-dark">{sessionError}</p>
      </div>
    );
  }

  const quotaText =
    jobsRemaining != null && jobsLimit != null
      ? `${jobsRemaining} of ${jobsLimit} imports this month`
      : planTier === 'pro'
        ? 'Pro plan — unlimited imports'
        : '';

  return (
    <div className="account-banner flex shrink-0 items-center justify-between gap-2 border-b border-stroke-soft-200 bg-bg-weak-50 px-3 py-2">
      <div className="account-banner-text flex min-w-0 flex-col gap-0.5">
        <span
          className={cn(
            'account-badge inline-block w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            planTier === 'pro'
              ? 'bg-success-lighter text-success-dark'
              : 'bg-information-lighter text-information-dark',
          )}
        >
          {planTier === 'pro' ? 'Pro' : 'Free'}
        </span>
        {quotaText ? (
          <span className="account-quota text-paragraph-xs text-text-sub-600">{quotaText}</span>
        ) : null}
      </div>
      <div className="account-banner-actions shrink-0">
        {planTier === 'free' ? (
          <button
            type="button"
            className="account-upgrade cursor-pointer border-0 bg-transparent p-1 text-paragraph-xs font-semibold text-feature-base hover:underline"
            onClick={onUpgrade}
          >
            Upgrade to Pro
          </button>
        ) : (
          <button
            type="button"
            className="account-manage cursor-pointer border-0 bg-transparent p-1 text-paragraph-xs font-semibold text-feature-base hover:underline"
            onClick={onManage}
          >
            Manage subscription
          </button>
        )}
      </div>
    </div>
  );
}
