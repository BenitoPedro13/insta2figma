import type { PrismaClient } from '@prisma/client';
import type { S3Client } from '@aws-sdk/client-s3';

import {
  mediaPostStorageKey,
  mediaProfileStorageKey,
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

export function guessExtFromMime(mime: string): string {
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

export async function fetchBytes(
  url: string,
): Promise<{ body: Buffer; contentType: string }> {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; Insta2FigmaWorker/1.0)',
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

export type EnsureMediaParams =
  | { kind: 'post'; shortcode: string; slot: number; url: string }
  | { kind: 'profile'; igUserId: string; url: string };

export type EnsureMediaResult = {
  id: string;
  mediaKey: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  /** true se os bytes já existiam em S3 (sem download). */
  reused: boolean;
};

function mediaKeyFor(params: EnsureMediaParams): string {
  return params.kind === 'profile'
    ? `profile:${params.igUserId}`
    : `${params.shortcode}:${params.slot}`;
}

/**
 * Garante que os bytes de uma imagem `(shortcode, slot)` (ou avatar) existem em
 * S3, content-addressed e partilhados por todos os jobs/users.
 * - HIT (`MediaAsset` já existe): toca `lastUsedAt`, **não** faz rede.
 * - MISS: descarrega 1× → `PUT` em `media/...` → upsert `MediaAsset`.
 * Idempotente sob corrida (upsert por `mediaKey` único + PUT overwrite).
 * Devolve `null` se o download falhar (o chamador trata como slot em falta).
 */
export async function ensureMediaAsset(
  prisma: PrismaClient,
  s3: { client: S3Client; bucket: string },
  params: EnsureMediaParams,
): Promise<EnsureMediaResult | null> {
  const mediaKey = mediaKeyFor(params);

  const existing = await prisma.mediaAsset.findUnique({ where: { mediaKey } });
  if (existing) {
    // HIT — sem rede. Toca lastUsedAt (best-effort).
    await prisma.mediaAsset
      .update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
    return {
      id: existing.id,
      mediaKey,
      storageKey: existing.storageKey,
      contentType: existing.contentType,
      byteSize: Number(existing.byteSize),
      reused: true,
    };
  }

  let fetched: { body: Buffer; contentType: string };
  try {
    fetched = await fetchBytes(params.url);
  } catch (e) {
    console.warn(
      '[media] falha a descarregar',
      mediaKey,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }

  const ext = guessExtFromMime(fetched.contentType);
  const storageKey =
    params.kind === 'profile'
      ? mediaProfileStorageKey(params.igUserId, ext)
      : mediaPostStorageKey(params.shortcode, params.slot, ext);

  await putObjectBytes({
    client: s3.client,
    bucket: s3.bucket,
    key: storageKey,
    body: fetched.body,
    contentType: fetched.contentType,
  });

  const byteSize = fetched.body.byteLength;
  const row = await prisma.mediaAsset.upsert({
    where: { mediaKey },
    create: {
      mediaKey,
      kind: params.kind,
      shortcode: params.kind === 'post' ? params.shortcode : null,
      slot: params.kind === 'post' ? params.slot : 0,
      contentType: fetched.contentType,
      storageKey,
      byteSize: BigInt(byteSize),
      sourceUrl: params.url,
    },
    update: {
      lastUsedAt: new Date(),
      storageKey,
      contentType: fetched.contentType,
      byteSize: BigInt(byteSize),
      sourceUrl: params.url,
    },
  });

  return {
    id: row.id,
    mediaKey,
    storageKey,
    contentType: fetched.contentType,
    byteSize,
    reused: false,
  };
}
