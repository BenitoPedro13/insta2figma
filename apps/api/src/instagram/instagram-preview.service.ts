import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildIndexedPostPreview,
  endSelectionIndex,
  estimateImportImages,
  parseTimelineSampleFromUserNode,
  resolveScrapeSelection,
  type InstagramPostPreviewItem,
  type InstagramPostSummaryItem,
  type ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.instagram.com/',
  Origin: 'https://www.instagram.com',
};
const IG_IMAGE_HEADERS: Record<string, string> = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (compatible; Insta2FigmaApi/1.0; +https://www.instagram.com/)',
  Referer: 'https://www.instagram.com/',
};
const MAX_AVATAR_BYTES = 900_000;
const MAX_POST_THUMB_BYTES = 520_000;
const PREVIEW_CACHE_TTL_MS = 45_000;
const PREVIEW_THUMB_CONCURRENCY = 4;

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase();
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

type CachedPreviewPayload = {
  username: string;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  parsedPosts: InstagramPostSummaryItem[];
  postsPreview: InstagramPostPreviewItem[];
  postsAvailable: number;
  timelineOrder: 'newest_first' | 'oldest_first';
};

type ProfilePreviewResponse = Omit<CachedPreviewPayload, 'parsedPosts'> & {
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  selectionMode: string;
  startIndex: number;
  postCount: number;
  selectionEndIndex: number;
  selectionAvailable: boolean;
  selectionWarning?: string;
};

async function fetchInstagramImageAsDataUrl(
  cdnUrl: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const img = await fetch(cdnUrl, {
      method: 'GET',
      headers: IG_IMAGE_HEADERS,
      signal: AbortSignal.timeout(18_000),
      redirect: 'follow',
    });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    const ctRaw = img.headers.get('content-type')?.split(';')[0]?.trim();
    const ct = ctRaw && ctRaw.startsWith('image/') ? ctRaw : 'image/jpeg';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function inlinePostsPreviewThumbnails(
  items: InstagramPostPreviewItem[],
): Promise<InstagramPostPreviewItem[]> {
  const out: InstagramPostPreviewItem[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      const raw = item.thumbnailUrl;
      if (!raw || raw.startsWith('data:')) {
        out[i] = item;
        continue;
      }
      const dataUrl = await fetchInstagramImageAsDataUrl(
        raw,
        MAX_POST_THUMB_BYTES,
      );
      out[i] = { ...item, thumbnailUrl: dataUrl };
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(PREVIEW_THUMB_CONCURRENCY, items.length) },
      () => worker(),
    ),
  );
  return out;
}

@Injectable()
export class InstagramPreviewService {
  private readonly previewCache = new Map<
    string,
    { expiresAt: number; payload: CachedPreviewPayload }
  >();

  async getProfilePreview(
    usernameRaw: string,
    opts?: ScrapeSelectionInput & {
      expandCarouselImages?: boolean;
      previewListSize?: number;
    },
  ): Promise<ProfilePreviewResponse> {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      throw new BadRequestException('username é obrigatório.');
    }

    const selection = resolveScrapeSelection(opts ?? {}, {
      defaultMaxPosts: opts?.maxPosts ?? 12,
    });
    const previewListSize = Math.min(
      50,
      Math.max(1, opts?.previewListSize ?? selection.fetchCount),
    );
    const fetchCount = Math.min(
      50,
      Math.max(previewListSize, selection.fetchCount),
    );
    const cacheKey = JSON.stringify({
      username,
      fetchCount,
      timelineOrder: selection.timelineOrder,
    });

    let base = this.readCache(cacheKey);
    if (!base) {
      base = await this.fetchInstagramPreviewBase(username, fetchCount, selection.timelineOrder);
      this.writeCache(cacheKey, base);
    }

    const expand = opts?.expandCarouselImages === true;
    const estimate = estimateImportImages(base.parsedPosts, selection, expand);

    const selectionEndIndex = endSelectionIndex(selection);
    const selectionAvailable = selectionEndIndex <= base.postsAvailable;
    let selectionWarning: string | undefined;
    if (!selectionAvailable) {
      selectionWarning = `Só ${base.postsAvailable} post(s) visíveis no preview. A posição #${selectionEndIndex} pode não estar disponível sem paginação extra.`;
    }

    return {
      username: base.username,
      profilePicUrlHd: base.profilePicUrlHd,
      profilePicDataUrl: base.profilePicDataUrl,
      mediaCount: base.mediaCount,
      isPrivate: base.isPrivate,
      postsPreview: base.postsPreview,
      postsAvailable: base.postsAvailable,
      timelineOrder: base.timelineOrder,
      ...estimate,
      selectionMode: selection.mode,
      startIndex: selection.startIndex,
      postCount: selection.postCount,
      selectionEndIndex,
      selectionAvailable,
      ...(selectionWarning ? { selectionWarning } : {}),
    };
  }

  private readCache(key: string): CachedPreviewPayload | null {
    const hit = this.previewCache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.previewCache.delete(key);
      return null;
    }
    return hit.payload;
  }

  private writeCache(key: string, payload: CachedPreviewPayload): void {
    this.previewCache.set(key, {
      expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
      payload,
    });
    if (this.previewCache.size > 128) {
      const oldest = this.previewCache.keys().next().value;
      if (oldest) this.previewCache.delete(oldest);
    }
  }

  private async fetchInstagramPreviewBase(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<CachedPreviewPayload> {
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: IG_HEADERS,
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Falha de rede ao consultar preview do Instagram.',
      );
    }

    if (res.status === 404) {
      throw new BadRequestException('Username não encontrado no Instagram.');
    }
    if (res.status === 429) {
      throw new ServiceUnavailableException(
        'Instagram com rate limit no preview. Aguarda ~1 minuto e tenta de novo.',
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Instagram preview indisponível (HTTP ${res.status}).`,
      );
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const envelope = toRecord(body);
    const data = toRecord(envelope?.data);
    const user = toRecord(data?.user);
    if (!user) {
      throw new BadRequestException('Perfil Instagram não encontrado.');
    }

    const edge = toRecord(user.edge_owner_to_timeline_media);
    const countRaw = edge?.count;
    const mediaCount =
      typeof countRaw === 'number' && Number.isFinite(countRaw)
        ? countRaw
        : 0;
    const hd =
      typeof user.profile_pic_url_hd === 'string'
        ? user.profile_pic_url_hd
        : typeof user.profile_pic_url === 'string'
          ? user.profile_pic_url
          : null;

    const parsedPosts = parseTimelineSampleFromUserNode(user, fetchCount);
    const postsPreviewRaw = buildIndexedPostPreview(parsedPosts, timelineOrder);
    const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

    let profilePicDataUrl: string | null = null;
    if (hd) {
      try {
        const img = await fetch(hd, {
          method: 'GET',
          headers: IG_IMAGE_HEADERS,
          signal: AbortSignal.timeout(20_000),
          redirect: 'follow',
        });
        if (img.ok) {
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.byteLength > 0 && buf.byteLength <= MAX_AVATAR_BYTES) {
            const ctRaw = img.headers.get('content-type')?.split(';')[0]?.trim();
            const ct = ctRaw && ctRaw.startsWith('image/') ? ctRaw : 'image/jpeg';
            profilePicDataUrl = `data:${ct};base64,${buf.toString('base64')}`;
          }
        }
      } catch {
        profilePicDataUrl = null;
      }
    }

    return {
      username:
        typeof user.username === 'string' && user.username
          ? user.username
          : username,
      profilePicUrlHd: hd,
      profilePicDataUrl,
      mediaCount,
      isPrivate: user.is_private === true,
      parsedPosts,
      postsPreview,
      postsAvailable: parsedPosts.length,
      timelineOrder,
    };
  }
}
