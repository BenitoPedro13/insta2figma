import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./s3-client', () => ({
  putObjectBytes: vi.fn().mockResolvedValue(undefined),
  mediaPostStorageKey: (sc: string, slot: number, ext: string) =>
    `media/${sc}/${slot}.${ext}`,
  mediaProfileStorageKey: (id: string, ext: string) => `media/profile/${id}.${ext}`,
}));

import { ensureMediaAsset } from './ensure-media-asset';
import { putObjectBytes } from './s3-client';

type Row = Record<string, unknown> & { id: string; mediaKey: string };

function makePrisma(initial: Record<string, Row> = {}) {
  const store = new Map<string, Row>(Object.entries(initial));
  let idc = 0;
  const prisma = {
    store,
    mediaAsset: {
      findUnique: vi.fn(
        async ({ where: { mediaKey } }: { where: { mediaKey: string } }) =>
          store.get(mediaKey) ?? null,
      ),
      update: vi.fn(
        async ({
          where: { id },
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const v of store.values()) if (v.id === id) Object.assign(v, data);
          return {};
        },
      ),
      upsert: vi.fn(
        async ({
          where: { mediaKey },
          create,
          update,
        }: {
          where: { mediaKey: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = store.get(mediaKey);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row = { id: `m${++idc}`, ...create } as Row;
          store.set(mediaKey, row);
          return row;
        },
      ),
    },
  };
  return prisma as unknown as Parameters<typeof ensureMediaAsset>[0] & {
    store: Map<string, Row>;
  };
}

const s3 = { client: {} as never, bucket: 'bucket' };

function stubFetchOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'image/jpeg' : null),
      },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubFetchOk();
});

describe('ensureMediaAsset', () => {
  it('MISS: downloads once, PUTs, upserts MediaAsset with content-addressed key', async () => {
    const prisma = makePrisma();
    const r = await ensureMediaAsset(prisma, s3, {
      kind: 'post',
      shortcode: 'AB',
      slot: 0,
      url: 'https://cdn/x.jpg',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(putObjectBytes).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      reused: false,
      storageKey: 'media/AB/0.jpg',
      contentType: 'image/jpeg',
      byteSize: 3,
    });
    expect(prisma.store.get('AB:0')).toBeTruthy();
  });

  it('HIT: existing MediaAsset reused without any network/PUT', async () => {
    const prisma = makePrisma({
      'AB:0': {
        id: 'm1',
        mediaKey: 'AB:0',
        storageKey: 'media/AB/0.jpg',
        contentType: 'image/jpeg',
        byteSize: BigInt(3),
      },
    });
    const r = await ensureMediaAsset(prisma, s3, {
      kind: 'post',
      shortcode: 'AB',
      slot: 0,
      url: 'https://cdn/x.jpg',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(putObjectBytes).not.toHaveBeenCalled();
    expect(r).toMatchObject({ reused: true, id: 'm1', storageKey: 'media/AB/0.jpg' });
  });

  it('profile kind uses profile mediaKey + key', async () => {
    const prisma = makePrisma();
    const r = await ensureMediaAsset(prisma, s3, {
      kind: 'profile',
      igUserId: '999',
      url: 'https://cdn/p.jpg',
    });
    expect(r?.storageKey).toBe('media/profile/999.jpg');
    expect(prisma.store.get('profile:999')).toBeTruthy();
  });

  it('download failure → null, no upsert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null } })),
    );
    const prisma = makePrisma();
    const r = await ensureMediaAsset(prisma, s3, {
      kind: 'post',
      shortcode: 'AB',
      slot: 1,
      url: 'https://cdn/x.jpg',
    });
    expect(r).toBeNull();
    expect(putObjectBytes).not.toHaveBeenCalled();
    expect(prisma.store.size).toBe(0);
  });
});
