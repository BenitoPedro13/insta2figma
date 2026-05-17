import type { PlanTier } from '@insta2figma/shared-contracts';

export type PlanLimits = {
  jobsPerMonth: number | null;
  maxPosts: number;
  expandCarouselImages: boolean;
};

const PRO_JOBS_SAFETY_CAP = 1000;

export function getPlanLimits(
  planTier: string,
  env: {
    freeJobsPerMonth: number;
    freeMaxPosts: number;
    proMaxPosts: number;
  },
): PlanLimits {
  if (planTier === 'pro') {
    return {
      jobsPerMonth: PRO_JOBS_SAFETY_CAP,
      maxPosts: env.proMaxPosts,
      expandCarouselImages: true,
    };
  }
  return {
    jobsPerMonth: env.freeJobsPerMonth,
    maxPosts: env.freeMaxPosts,
    expandCarouselImages: false,
  };
}

export function normalizePlanTier(tier: string): PlanTier {
  return tier === 'pro' ? 'pro' : 'free';
}

export function currentPeriodStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
