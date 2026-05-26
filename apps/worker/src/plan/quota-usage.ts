import type { PrismaClient } from '@prisma/client';
import { estimateImagesForJobInput } from '@insta2figma/shared-contracts';

export function currentPeriodStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function readEstimatedImportImages(input: unknown): number {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return 1;
  }
  return estimateImagesForJobInput(input as Parameters<typeof estimateImagesForJobInput>[0]);
}

export async function adjustUserImagesUsed(
  prisma: PrismaClient,
  userId: string,
  delta: number,
): Promise<void> {
  if (!Number.isFinite(delta) || delta === 0) return;
  const periodStart = currentPeriodStartUtc();
  const change = Math.floor(delta);
  await prisma.usageCounter.upsert({
    where: { userId_periodStart: { userId, periodStart } },
    create: { userId, periodStart, imagesUsed: Math.max(0, change) },
    update: { imagesUsed: { increment: change } },
  });
}

export async function countBillableJobImages(
  prisma: PrismaClient,
  jobId: string,
): Promise<number> {
  const assets = await prisma.asset.findMany({
    where: { jobId },
    select: { storageKey: true },
  });
  return assets.filter((asset) => asset.storageKey.includes('/thumbs/')).length;
}
