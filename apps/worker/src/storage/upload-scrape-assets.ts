import type { PrismaClient } from '@prisma/client';
import type { ScrapeJobResultSummaryV5 } from '@insta2figma/shared-contracts';

import {
  createS3PutClient,
  jobStoragePrefix,
  isS3Configured,
} from './s3-client';
import { ensureMediaAsset } from './ensure-media-asset';

const MAX_THUMBS = Math.min(
  24,
  Math.max(
    1,
    Number.parseInt(process.env.STORAGE_MAX_THUMBNAILS ?? '12', 10) || 12,
  ),
);

const MAX_THUMBS_EXPANDED = Math.min(
  150,
  Math.max(
    MAX_THUMBS,
    Number.parseInt(process.env.STORAGE_MAX_THUMBNAILS_EXPANDED ?? '96', 10) ||
      96,
  ),
);

/**
 * Garante as imagens do scrape no store content-addressed (`MediaAsset`, dedupado
 * globalmente) e cria as linhas `Asset` por-job que apontam para esses bytes.
 * - `profile`: avatar para o histórico/favoritos.
 * - `post` (slot 0 = cover; 1..N = carrossel quando `expandCarouselImages`).
 *
 * Reuso: se os bytes já existem em S3 (outro user/job), **não** há download — só
 * se cria a referência `Asset`. Falhas por item são ignoradas (log).
 */
export async function uploadScrapeAssets(params: {
  prisma: PrismaClient;
  jobId: string;
  summary: ScrapeJobResultSummaryV5;
  /** Se true, também faz upload das URLs extra em cada `carouselImageUrls`. */
  expandCarouselImages?: boolean;
}): Promise<string | null> {
  if (!isS3Configured()) {
    console.info('[storage] S3 não configurado — a saltar upload de assets.');
    return null;
  }

  const client = createS3PutClient();
  const bucket = process.env.S3_BUCKET!.trim();
  if (!client) return null;
  const s3 = { client, bucket };

  const { prisma, jobId } = params;

  // Avatar do perfil → MediaAsset 'profile' (chave por igUserId).
  const profileUrl = params.summary.profile.profilePicUrlHd;
  const igUserId = params.summary.profile.id;
  if (profileUrl && igUserId) {
    try {
      const result = await ensureMediaAsset(prisma, s3, {
        kind: 'profile',
        igUserId,
        url: profileUrl,
      });
      if (result) {
        await prisma.asset.create({
          data: {
            jobId,
            storageKey: result.storageKey,
            contentType: result.contentType,
            byteSize: BigInt(result.byteSize),
            kind: 'profile',
            shortcode: null,
            slot: 0,
            mediaAssetId: result.id,
            expiresAt: null,
          },
        });
      }
    } catch (e) {
      console.warn('[storage] falha ao guardar foto de perfil', e);
    }
  }

  const expand = params.expandCarouselImages === true;
  const maxSlots = expand ? MAX_THUMBS_EXPANDED : MAX_THUMBS;

  // Colectar tasks upfront (slot 0 = cover; 1..N = carrossel) para paralelizar.
  type ThumbTask = { url: string; slot: number; shortcode: string };
  const tasks: ThumbTask[] = [];

  for (const p of params.summary.postsSample) {
    if (tasks.length >= maxSlots) break;

    const urls: string[] = [];
    if (p.thumbnailUrl) urls.push(p.thumbnailUrl);
    if (expand && Array.isArray(p.carouselImageUrls)) {
      for (const cu of p.carouselImageUrls) {
        if (cu && !urls.includes(cu)) urls.push(cu);
      }
    }

    if (urls.length === 0) {
      console.warn(`[storage] post ${p.shortcode} sem URL de thumbnail — a saltar`);
      continue;
    }

    for (let slot = 0; slot < urls.length; slot++) {
      if (tasks.length >= maxSlots) break;
      tasks.push({ url: urls[slot], slot, shortcode: p.shortcode });
    }
  }

  console.info(
    `[storage] ${params.summary.postsSample.length} posts, ${tasks.length} slots pendentes`,
  );

  // Pool de concorrência — mesmo padrão do inlinePostsPreviewThumbnails da API.
  const UPLOAD_CONCURRENCY = 5;
  let succeeded = 0;
  let reused = 0;
  let taskIdx = 0;

  async function uploadWorker(): Promise<void> {
    while (taskIdx < tasks.length) {
      const task = tasks[taskIdx++];
      try {
        const result = await ensureMediaAsset(prisma, s3, {
          kind: 'post',
          shortcode: task.shortcode,
          slot: task.slot,
          url: task.url,
        });
        if (!result) continue;
        if (result.reused) reused++;
        await prisma.asset.create({
          data: {
            jobId,
            storageKey: result.storageKey,
            contentType: result.contentType,
            byteSize: BigInt(result.byteSize),
            kind: 'post',
            shortcode: task.shortcode,
            slot: task.slot,
            mediaAssetId: result.id,
            expiresAt: null,
          },
        });
        succeeded++;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.warn('[storage] falha slot', task.shortcode, task.slot, {
          url: task.url.slice(0, 80),
          reason,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, tasks.length) }, uploadWorker),
  );

  console.info(
    `[storage] assets prontos — ${succeeded}/${tasks.length} (${reused} reutilizados sem download)`,
  );
  return jobStoragePrefix(jobId);
}
