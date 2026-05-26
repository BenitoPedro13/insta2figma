import type { PlanTier } from '@insta2figma/shared-contracts';

export type PlanLimits = {
  imagesPerMonth: number;
  maxPosts: number;
  expandCarouselImages: boolean;
};

export function getPlanLimits(
  planTier: string,
  env: {
    freeImagesPerMonth: number;
    proImagesPerMonth: number;
    maxPostsPerJob: number;
  },
): PlanLimits {
  if (planTier === 'pro') {
    return {
      imagesPerMonth: env.proImagesPerMonth,
      maxPosts: env.maxPostsPerJob,
      expandCarouselImages: true,
    };
  }
  return {
    imagesPerMonth: env.freeImagesPerMonth,
    maxPosts: env.maxPostsPerJob,
    expandCarouselImages: true,
  };
}

export function normalizePlanTier(tier: string): PlanTier {
  return tier === 'pro' ? 'pro' : 'free';
}

export function currentPeriodStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
