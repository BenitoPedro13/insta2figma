export const QUOTA_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export type ResolvedQuotaPeriod = {
  periodStart: Date;
  periodEnd: Date;
  anchored: boolean;
};

function truncateToUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Janela móvel de 30 dias a partir do primeiro import (quotaAnchorAt). */
export function resolveQuotaPeriod(
  quotaAnchorAt: Date | null | undefined,
  now = new Date(),
): ResolvedQuotaPeriod {
  if (!quotaAnchorAt) {
    const periodStart = truncateToUtcDate(now);
    return {
      periodStart,
      periodEnd: new Date(now.getTime() + QUOTA_PERIOD_MS),
      anchored: false,
    };
  }

  const elapsed = now.getTime() - quotaAnchorAt.getTime();
  const periodIndex = Math.max(0, Math.floor(elapsed / QUOTA_PERIOD_MS));
  const periodStartInstant = new Date(
    quotaAnchorAt.getTime() + periodIndex * QUOTA_PERIOD_MS,
  );
  const periodEndInstant = new Date(periodStartInstant.getTime() + QUOTA_PERIOD_MS);

  return {
    periodStart: truncateToUtcDate(periodStartInstant),
    periodEnd: periodEndInstant,
    anchored: true,
  };
}
