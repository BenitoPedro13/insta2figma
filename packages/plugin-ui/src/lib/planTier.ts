import type { PlanTier } from '@insta2figma/shared-contracts';

export type { PlanTier };

export function parsePlanTier(raw: unknown): PlanTier {
  if (raw === 'max') return 'max';
  if (raw === 'pro') return 'pro';
  return 'free';
}

export function planTierLabel(tier: PlanTier): string {
  if (tier === 'max') return 'Max';
  if (tier === 'pro') return 'Pro';
  return 'Free';
}

export function isPaidPlan(tier: PlanTier): boolean {
  return tier === 'pro' || tier === 'max';
}
