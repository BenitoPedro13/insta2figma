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
    throw new Error(`HTTP ${res.status} ao descarregar media`);
  }
  const len = res.headers.get('content-length');
  if (len !== null) {
    const n = Number.parseInt(len, 10);
    if (Number.isFinite(n) && n > MAX_BYTES) {
      throw new Error('Ficheiro demasiado grande.');
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    throw new Error('Ficheiro demasiado grande.');
  }
  const ct = res.headers.get('content-type')?.split(';')[0]?.trim() || '';
  const contentType =
    ct && ct.startsWith('image/') ? ct : 'application/octet-stream';
  return { body: buf, contentType };
}

/**
 * Upload opcional de thumbnails dos posts para S3/MinIO e cria linhas `Asset`.
 * A foto de perfil (~`profile_pic_url_hd`) fica apenas no JSON `result_summary.profile`;
 * não é copiada para o bucket para o import no Figma ser só miniaturas de posts pedidos.
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

  let count = 0;
  const expand = params.expandCarouselImages === true;
  const maxSlots = expand ? MAX_THUMBS_EXPANDED : MAX_THUMBS;

  for (const p of params.summary.postsSample) {
    if (count >= maxSlots) break;

    const urlsToStore: string[] = [];
    if (p.thumbnailUrl) urlsToStore.push(p.thumbnailUrl);
    if (expand && Array.isArray(p.carouselImageUrls)) {
      for (const cu of p.carouselImageUrls) {
        if (!cu || urlsToStore.includes(cu)) continue;
        urlsToStore.push(cu);
      }
    }

    if (urlsToStore.length === 0) continue;

    let slotIdx = 0;
    for (const url of urlsToStore) {
      if (count >= maxSlots) break;
      try {
        const { body, contentType } = await fetchBytes(url);
        const ext = guessExtFromMime(contentType);
        const slug =
          urlsToStore.length <= 1 ? p.shortcode : `${p.shortcode}_${slotIdx}`;
        slotIdx += 1;
        const key = `${prefix}thumbs/${slug}.${ext}`;
        await persist(key, body, contentType);
        count += 1;
      } catch (e) {
        console.warn('[storage] falha thumbnail', p.shortcode, slotIdx - 1, e);
      }
    }
  }

  return prefix;
}
