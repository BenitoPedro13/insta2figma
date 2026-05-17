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
      <div className="account-banner account-banner--error">
        <p>{sessionError}</p>
      </div>
    );
  }

  const quotaText =
    jobsRemaining != null && jobsLimit != null
      ? `${jobsRemaining} de ${jobsLimit} imports este mês`
      : planTier === 'pro'
        ? 'Plano Pro — imports ilimitados'
        : '';

  return (
    <div className="account-banner">
      <div className="account-banner-text">
        <span className={`account-badge account-badge--${planTier}`}>
          {planTier === 'pro' ? 'Pro' : 'Free'}
        </span>
        {quotaText ? <span className="account-quota">{quotaText}</span> : null}
      </div>
      <div className="account-banner-actions">
        {planTier === 'free' ? (
          <button type="button" className="account-upgrade" onClick={onUpgrade}>
            Upgrade to Pro
          </button>
        ) : (
          <button type="button" className="account-manage" onClick={onManage}>
            Gerir subscrição
          </button>
        )}
      </div>
    </div>
  );
}
