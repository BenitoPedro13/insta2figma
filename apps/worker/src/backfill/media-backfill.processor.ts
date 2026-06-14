import type { PrismaClient } from '@prisma/client';
import { mediaBackfillV1JobPayloadSchema } from '@insta2figma/shared-contracts';

import { createS3PutClient, isS3Configured } from '../storage/s3-client';
import { ensureMediaAsset } from '../storage/ensure-media-asset';

/**
 * Consumidor da fila `media-backfill-v1` (§6.6): descarrega os bytes dos covers
 * (e avatar) descobertos pela preview para o store content-addressed.
 *
 * - Idempotente: `ensureMediaAsset` faz HIT (sem rede) se os bytes já existem.
 * - Ao concluir todos os slots, marca `IgPost.imagesReady = true` (tolera o post
 *   ainda não existir — corrida com o write-through).
 * - Se algum slot falhar (ex.: URL CDN expirada), **lança** → BullMQ tenta de novo
 *   (até `attempts`); esgotado, fica `imagesReady=false` e uma preview futura
 *   re-enfileira com URL fresca.
 */
export async function processMediaBackfillJob(
  prisma: PrismaClient,
  rawData: unknown,
): Promise<void> {
  const parsed = mediaBackfillV1JobPayloadSchema.safeParse(rawData);
  if (!parsed.success) {
    console.warn('[backfill] payload inválido', parsed.error.flatten());
    return;
  }
  if (!isS3Configured()) {
    console.warn('[backfill] S3 não configurado — skip');
    return;
  }
  const client = createS3PutClient();
  if (!client) return;
  const s3 = { client, bucket: process.env.S3_BUCKET!.trim() };

  const { shortcode, slots, igUserId, profilePicUrl } = parsed.data;

  let failed = 0;
  for (const { slot, url } of slots) {
    const r = await ensureMediaAsset(prisma, s3, {
      kind: 'post',
      shortcode,
      slot,
      url,
    });
    if (!r) failed++;
  }

  if (igUserId && profilePicUrl) {
    try {
      await ensureMediaAsset(prisma, s3, {
        kind: 'profile',
        igUserId,
        url: profilePicUrl,
      });
    } catch (e) {
      console.warn(
        '[backfill] avatar falhou',
        igUserId,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  if (failed === 0) {
    await prisma.igPost
      .updateMany({ where: { shortcode }, data: { imagesReady: true } })
      .catch(() => {});
    return;
  }

  throw new Error(
    `[backfill] ${failed}/${slots.length} slots falharam para ${shortcode}`,
  );
}
