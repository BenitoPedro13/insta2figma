import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  MEDIA_BACKFILL_V1_QUEUE,
  type InstagramPostSummaryItem,
  type MediaBackfillV1JobPayload,
} from '@insta2figma/shared-contracts';
import { PrismaService } from '../../prisma/prisma.service';

const WRITE_THROUGH_ENABLED =
  (process.env.CATALOG_WRITE_THROUGH ?? 'true').toLowerCase() !== 'false';

// Enfileiramento do backfill de imagens (async). Default OFF — ligar só depois de
// o worker de backfill estar a consumir a fila (rollout: 3b antes de 3a).
const BACKFILL_ENABLED =
  (process.env.CATALOG_BACKFILL_ENABLED ?? 'false').toLowerCase() === 'true';
const BACKFILL_ATTEMPTS = Math.max(
  1,
  Number.parseInt(process.env.MEDIA_BACKFILL_ATTEMPTS ?? '3', 10) || 3,
);

export type CatalogWriteInput = {
  /** Username (será normalizado p/ lowercase). */
  username: string;
  igUserId: string | null;
  mediaCount?: number;
  isPrivate?: boolean;
  profilePicUrl?: string | null;
  /** Posts parseados (com `takenAt`/`caption`/`carouselImageUrls`). */
  posts: InstagramPostSummaryItem[];
};

/**
 * Persistência write-through do catálogo Instagram (Fase 2).
 *
 * Escreve `IgProfile` + `IgPost` (metadados) a partir do que a preview/scrape já
 * obteve, **sem** mudar o caminho de leitura. Best-effort: nunca lança para o
 * chamador (uma falha de catálogo não pode partir uma preview). Idempotente via
 * `upsert` por chaves únicas (`username`, `shortcode`).
 *
 * Os *bytes* das imagens NÃO entram aqui — chegam via import (worker) ou, em
 * fases seguintes, via backfill assíncrono. Só metadados.
 */
@Injectable()
export class IgCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(MEDIA_BACKFILL_V1_QUEUE) private readonly backfillQueue: Queue,
  ) {}

  isEnabled(): boolean {
    return WRITE_THROUGH_ENABLED;
  }

  // ─── Leitura (Fase 3a) ─────────────────────────────────────────────────────

  getProfileByUsername(username: string) {
    const u = username.trim().toLowerCase();
    if (!u) return Promise.resolve(null);
    return this.prisma.igProfile.findUnique({ where: { username: u } });
  }

  /** Posts mais recentes do catálogo, ordenados por `takenAt desc` (tiebreak shortcode). */
  getRecentPosts(profileId: string, limit: number) {
    return this.prisma.igPost.findMany({
      where: { profileId },
      orderBy: [{ takenAt: 'desc' }, { shortcode: 'desc' }],
      take: Math.max(1, Math.min(50, limit)),
    });
  }

  /** Covers (slot 0) em S3 para os `shortcodes` dados → Map<shortcode, {storageKey, contentType}>. */
  async getCoverAssets(
    shortcodes: string[],
  ): Promise<Map<string, { storageKey: string; contentType: string }>> {
    const out = new Map<string, { storageKey: string; contentType: string }>();
    if (shortcodes.length === 0) return out;
    const rows = await this.prisma.mediaAsset.findMany({
      where: { kind: 'post', slot: 0, shortcode: { in: shortcodes } },
      select: { shortcode: true, storageKey: true, contentType: true },
    });
    for (const r of rows) {
      if (r.shortcode) {
        out.set(r.shortcode, {
          storageKey: r.storageKey,
          contentType: r.contentType,
        });
      }
    }
    return out;
  }

  /** Avatar (MediaAsset `profile:<igUserId>`) em S3, se já backfilled. */
  async getProfileAvatarAsset(
    igUserId: string,
  ): Promise<{ storageKey: string } | null> {
    const row = await this.prisma.mediaAsset.findUnique({
      where: { mediaKey: `profile:${igUserId}` },
      select: { storageKey: true },
    });
    return row ?? null;
  }

  async writeThrough(input: CatalogWriteInput): Promise<void> {
    if (!WRITE_THROUGH_ENABLED) return;
    try {
      await this.persist(input);
    } catch (e) {
      console.warn(
        '[catalog] write-through falhou',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  private async persist(input: CatalogWriteInput): Promise<void> {
    const username = input.username.trim().toLowerCase();
    if (!username) return;

    const now = new Date();

    const profile = await this.prisma.igProfile.upsert({
      where: { username },
      create: {
        username,
        igUserId: input.igUserId ?? null,
        mediaCount: input.mediaCount ?? 0,
        isPrivate: input.isPrivate ?? false,
        lastRefreshedAt: now,
      },
      update: {
        ...(input.igUserId ? { igUserId: input.igUserId } : {}),
        ...(typeof input.mediaCount === 'number'
          ? { mediaCount: input.mediaCount }
          : {}),
        ...(typeof input.isPrivate === 'boolean'
          ? { isPrivate: input.isPrivate }
          : {}),
        lastRefreshedAt: now,
      },
    });

    let newestAt: Date | null = null;
    let newestShortcode: string | null = null;
    let oldestAt: Date | null = null;

    for (const p of input.posts) {
      if (!p.shortcode) continue;
      const takenAt =
        typeof p.takenAt === 'number' && p.takenAt > 0
          ? new Date(p.takenAt * 1000)
          : now;
      const carouselCount =
        1 + (Array.isArray(p.carouselImageUrls) ? p.carouselImageUrls.length : 0);

      await this.prisma.igPost.upsert({
        where: { shortcode: p.shortcode },
        create: {
          profileId: profile.id,
          shortcode: p.shortcode,
          takenAt,
          isVideo: p.isVideo === true,
          caption: p.caption ?? null,
          carouselCount,
          lastSeenAt: now,
        },
        update: {
          // `takenAt` é imutável p/ um post → não tocar.
          isVideo: p.isVideo === true,
          ...(p.caption != null ? { caption: p.caption } : {}),
          carouselCount,
          lastSeenAt: now,
        },
      });

      if (!newestAt || takenAt > newestAt) {
        newestAt = takenAt;
        newestShortcode = p.shortcode;
      }
      if (!oldestAt || takenAt < oldestAt) {
        oldestAt = takenAt;
      }
    }

    // High-water marks — monotónicos (só avançam).
    const data: Record<string, unknown> = {};
    if (newestAt && (!profile.newestPostAt || newestAt > profile.newestPostAt)) {
      data.newestPostAt = newestAt;
      data.newestShortcode = newestShortcode;
    }
    if (oldestAt && (!profile.oldestPostAt || oldestAt < profile.oldestPostAt)) {
      data.oldestPostAt = oldestAt;
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.igProfile.update({ where: { id: profile.id }, data });
    }

    await this.enqueueBackfill(input);
  }

  /**
   * Enfileira o backfill assíncrono dos covers (slot 0) dos posts cujos bytes
   * ainda não estão em S3. `jobId='media:'+shortcode` colapsa enqueues
   * duplicados; o consumidor reverifica `MediaAsset` por idempotência. O avatar
   * (igUserId+profilePicUrl) é anexado a um único job por refresh.
   */
  private async enqueueBackfill(input: CatalogWriteInput): Promise<void> {
    if (!BACKFILL_ENABLED) return;
    const candidates = input.posts.filter(
      (p): p is InstagramPostSummaryItem & { thumbnailUrl: string } =>
        !!p.shortcode &&
        typeof p.thumbnailUrl === 'string' &&
        p.thumbnailUrl.length > 0,
    );
    if (candidates.length === 0) return;

    try {
      const shortcodes = candidates.map((p) => p.shortcode);
      const ready = new Set(
        (
          await this.prisma.igPost.findMany({
            where: { shortcode: { in: shortcodes }, imagesReady: true },
            select: { shortcode: true },
          })
        ).map((r) => r.shortcode),
      );

      let attachedProfile = false;
      const jobs = candidates
        .filter((p) => !ready.has(p.shortcode))
        .map((p) => {
          const attachProfile =
            !attachedProfile && !!input.igUserId && !!input.profilePicUrl;
          if (attachProfile) attachedProfile = true;
          const payload: MediaBackfillV1JobPayload = {
            shortcode: p.shortcode,
            slots: [{ slot: 0, url: p.thumbnailUrl }],
            ...(attachProfile
              ? { igUserId: input.igUserId!, profilePicUrl: input.profilePicUrl! }
              : {}),
          };
          return {
            name: 'run',
            data: payload,
            opts: {
              jobId: `media:${p.shortcode}`,
              attempts: BACKFILL_ATTEMPTS,
              backoff: { type: 'exponential' as const, delay: 2000 },
              removeOnComplete: true,
              removeOnFail: 100,
            },
          };
        });

      if (jobs.length > 0) await this.backfillQueue.addBulk(jobs);
    } catch (e) {
      console.warn(
        '[catalog] enqueue backfill falhou',
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}
