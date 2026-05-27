import type { PlanTier } from '@insta2figma/shared-contracts';

export type PlanLimits = {
  imagesPerMonth: number;
  maxPosts: number;
  maxImagesPerJob: number;
  expandCarouselImages: boolean;
};

export function getPlanLimits(
  planTier: string,
  env: {
    freeImagesPerMonth: number;
    proImagesPerMonth: number;
    maxImagesPerMonth: number;
    maxPostsPerJob: number;
    maxImagesPerJob: number;
  },
): PlanLimits {
  if (planTier === 'max') {
    return {
      imagesPerMonth: env.maxImagesPerMonth,
      maxPosts: env.maxPostsPerJob,
      maxImagesPerJob: env.maxImagesPerJob,
      expandCarouselImages: true,
    };
  }
  if (planTier === 'pro') {
    return {
      imagesPerMonth: env.proImagesPerMonth,
      maxPosts: env.maxPostsPerJob,
      maxImagesPerJob: env.maxImagesPerJob,
      expandCarouselImages: true,
    };
  }
  return {
    imagesPerMonth: env.freeImagesPerMonth,
    maxPosts: env.maxPostsPerJob,
    maxImagesPerJob: env.maxImagesPerJob,
    expandCarouselImages: true,
  };
}

export function normalizePlanTier(tier: string): PlanTier {
  if (tier === 'max') return 'max';
  if (tier === 'pro') return 'pro';
  return 'free';
}
