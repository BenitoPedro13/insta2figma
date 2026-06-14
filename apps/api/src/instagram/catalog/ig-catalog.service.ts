import { Injectable } from '@nestjs/common';
import type { InstagramPostSummaryItem } from '@insta2figma/shared-contracts';
import { PrismaService } from '../../prisma/prisma.service';

const WRITE_THROUGH_ENABLED =
  (process.env.CATALOG_WRITE_THROUGH ?? 'true').toLowerCase() !== 'false';

export type CatalogWriteInput = {
  /** Username (será normalizado p/ lowercase). */
  username: string;
  igUserId: string | null;
  mediaCount?: number;
  isPrivate?: boolean;
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
  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return WRITE_THROUGH_ENABLED;
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
  }
}
