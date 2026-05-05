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
 * Upload opcional de avatar + thumbnails para S3/MinIO e cria linhas `Asset`.
 * Falhas por item são ignoradas (log).
 */
export async function uploadScrapeAssets(params: {
  prisma: PrismaClient;
  jobId: string;
  summary: ScrapeJobResultSummaryV5;
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
      const key = `${prefix}profile.${ext}`;
      await persist(key, body, contentType);
    } catch (e) {
      console.warn('[storage] falha ao guardar foto de perfil', e);
    }
  }

  let count = 0;
  for (const p of params.summary.postsSample) {
    if (count >= MAX_THUMBS) break;
    if (!p.thumbnailUrl) continue;
    try {
      const { body, contentType } = await fetchBytes(p.thumbnailUrl);
      const ext = guessExtFromMime(contentType);
      const key = `${prefix}thumbs/${p.shortcode}.${ext}`;
      await persist(key, body, contentType);
      count += 1;
    } catch (e) {
      console.warn('[storage] falha thumbnail', p.shortcode, e);
    }
  }

  return prefix;
}
