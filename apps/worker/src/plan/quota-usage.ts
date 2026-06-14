import type { PrismaClient } from '@prisma/client';
import {
  estimateImagesForJobInput,
  resolveQuotaPeriod,
} from '@insta2figma/shared-contracts';

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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quotaAnchorAt: true },
  });
  if (!user?.quotaAnchorAt) return;

  const periodStart = resolveQuotaPeriod(user.quotaAnchorAt).periodStart;
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
    select: { kind: true, storageKey: true },
  });
  // Conta imagens de post (não o avatar). `kind` é a fonte de verdade; mantém-se o
  // fallback à string p/ Assets antigos (sem `kind`, keys `…/thumbs/…`).
  return assets.filter((asset) =>
    asset.kind !== null
      ? asset.kind === 'post'
      : asset.storageKey.includes('/thumbs/'),
  ).length;
}
