import { describe, expect, it } from 'vitest';
import { resolveQuotaPeriod, QUOTA_PERIOD_MS } from './quota-period';

describe('resolveQuotaPeriod', () => {
  it('returns unanchored period before first import', () => {
    const now = new Date('2026-05-25T12:00:00.000Z');
    const period = resolveQuotaPeriod(null, now);
    expect(period.anchored).toBe(false);
    expect(period.periodEnd.getTime() - now.getTime()).toBe(QUOTA_PERIOD_MS);
  });

  it('rolls 30-day windows from anchor', () => {
    const anchor = new Date('2026-01-01T15:30:00.000Z');
    const duringFirst = resolveQuotaPeriod(
      anchor,
      new Date('2026-01-20T10:00:00.000Z'),
    );
    expect(duringFirst.anchored).toBe(true);
    expect(duringFirst.periodStart.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(duringFirst.periodEnd.toISOString()).toBe('2026-01-31T15:30:00.000Z');

    const secondWindow = resolveQuotaPeriod(
      anchor,
      new Date('2026-02-05T10:00:00.000Z'),
    );
    expect(secondWindow.periodStart.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(secondWindow.periodEnd.toISOString()).toBe('2026-03-02T15:30:00.000Z');
  });
});
