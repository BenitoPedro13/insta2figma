import type { PrismaClient } from '@prisma/client';
import type { ScrapeJobResultSummaryV5 } from '@insta2figma/shared-contracts';

import {
  createS3PutClient,
  jobStoragePrefix,
  isS3Configured,
  putObjectBytes,
} from './s3-client';

const FETCH_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.ASSET_FETCH_TIMEOUT_MS ?? '20000', 10) || 20_000,
);

const MAX_BYTES = Math.min(
  12 * 1024 * 1024,
  Math.max(
    256 * 1024,
    Number.parseInt(process.env.ASSET_MAX_BYTES ?? `${5 * 1024 * 1024}`, 10) ||
      5 * 1024 * 1024,
  ),
);

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

function guessExtFromMime(mime: string): string {
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

async function fetchBytes(
  url: string,
): Promise<{ body: Buffer; contentType: string }> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (compatible; Insta2FigmaWorker/1.0)',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} while downloading media`);
  }
  const len = res.headers.get('content-length');
  if (len !== null) {
    const n = Number.parseInt(len, 10);
    if (Number.isFinite(n) && n > MAX_BYTES) {
      throw new Error('File is too large.');
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error('File is too large.');
  }
  const ct = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  const contentType =
    ct && ct.startsWith('image/') ? ct : 'application/octet-stream';
  return { body: buf, contentType };
}

/**
 * Upload opcional de assets para S3/MinIO e cria linhas `Asset`.
 * - `profile.*`: foto de perfil para avatar no histórico/favoritos.
 * - `thumbs/*`: miniaturas dos posts para import no canvas.
 * Falhas por item são ignoradas (log).
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

  const prefix = jobStoragePrefix(params.jobId);

  const persist = async (
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> => {
    await putObjectBytes({ client, bucket, key, body, contentType });
    await params.prisma.asset.create({
      data: {
        jobId: params.jobId,
        storageKey: key,
        contentType,
        byteSize: BigInt(body.byteLength),
        expiresAt: null,
      },
    });
  };

  const profileUrl = params.summary.profile.profilePicUrlHd;
  if (profileUrl) {
    try {
      const { body, contentType } = await fetchBytes(profileUrl);
      const ext = guessExtFromMime(contentType);
      await persist(`${prefix}profile.${ext}`, body, contentType);
    } catch (e) {
      console.warn('[storage] falha ao guardar foto de perfil', e);
    }
  }

  const expand = params.expandCarouselImages === true;
  const maxSlots = expand ? MAX_THUMBS_EXPANDED : MAX_THUMBS;

  // Colectar tasks upfront para poder paralelizar sem race conditions no índice
  type ThumbTask = { url: string; slug: string; shortcode: string };
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

    for (let slotIdx = 0; slotIdx < urls.length; slotIdx++) {
      if (tasks.length >= maxSlots) break;
      const slug = urls.length === 1 ? p.shortcode : `${p.shortcode}_${slotIdx}`;
      tasks.push({ url: urls[slotIdx], slug, shortcode: p.shortcode });
    }
  }

  console.info(
    `[storage] ${params.summary.postsSample.length} posts, ${tasks.length} uploads pendentes`,
  );

  // Pool de concorrência — mesmo padrão do inlinePostsPreviewThumbnails da API
  const UPLOAD_CONCURRENCY = 5;
  let succeeded = 0;
  let taskIdx = 0;

  async function uploadWorker(): Promise<void> {
    while (taskIdx < tasks.length) {
      const task = tasks[taskIdx++];
      try {
        const { body, contentType } = await fetchBytes(task.url);
        const ext = guessExtFromMime(contentType);
        await persist(`${prefix}thumbs/${task.slug}.${ext}`, body, contentType);
        succeeded++;
      } catch (e) {
        console.warn('[storage] falha thumbnail', task.shortcode, e);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, tasks.length) }, uploadWorker),
  );

  console.info(`[storage] upload completo — ${succeeded}/${tasks.length} assets guardados no S3`);
  return prefix;
}
