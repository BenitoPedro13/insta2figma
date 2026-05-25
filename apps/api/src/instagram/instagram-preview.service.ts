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
  PREVIEW_PAGE_SIZE,
  resolveScrapeSelection,
  type InstagramPostPreviewItem,
  type InstagramPostSummaryItem,
  type ScrapeSelectionInput,
  type TimelinePostItem,
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
const IG_GRAPHQL_QUERY_ID = '17888483320059182';
const FREE_MAX_PREVIEW_PAGE = 3;

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
  instagramUserId: string | null;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  parsedPosts: InstagramPostSummaryItem[];
  postsPreview: InstagramPostPreviewItem[];
  postsAvailable: number;
  timelineOrder: 'newest_first' | 'oldest_first';
  hasNextPreviewPage: boolean;
  nextPreviewCursor: string | null;
  previewTotalPages: number;
};

type ProfilePreviewResponse = Omit<CachedPreviewPayload, 'parsedPosts'> & {
  previewPage: number;
  previewPageSize: number;
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
      previewPage?: number;
      after?: string;
      userId?: string;
      planTier?: 'free' | 'pro';
    },
  ): Promise<ProfilePreviewResponse> {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      throw new BadRequestException('username é obrigatório.');
    }

    const previewPage = Math.max(1, Math.floor(opts?.previewPage ?? 1));
    const planTier = opts?.planTier === 'pro' ? 'pro' : 'free';
    if (planTier === 'free' && previewPage > FREE_MAX_PREVIEW_PAGE) {
      throw new BadRequestException(
        'Preview pagination beyond page 3 requires Pro.',
      );
    }

    const selection = resolveScrapeSelection(opts ?? {}, {
      defaultMaxPosts: opts?.maxPosts ?? 12,
    });
    const timelineOrder = selection.timelineOrder;

    if (previewPage > 1) {
      const after = String(opts?.after ?? '').trim();
      const userId = String(opts?.userId ?? '').trim();
      if (!after || !userId) {
        throw new BadRequestException(
          'Paginação do preview requer userId e after.',
        );
      }

      const pagePosts = await this.fetchTimelinePageByCursor(
        userId,
        after,
        PREVIEW_PAGE_SIZE,
      );
      const postsPreviewRaw = buildIndexedPostPreview(
        pagePosts.posts,
        timelineOrder,
        { indexStart: (previewPage - 1) * PREVIEW_PAGE_SIZE + 1 },
      );
      const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

      return {
        username,
        instagramUserId: userId,
        profilePicUrlHd: null,
        profilePicDataUrl: null,
        mediaCount: 0,
        isPrivate: false,
        postsPreview,
        postsAvailable: postsPreview.length,
        timelineOrder,
        hasNextPreviewPage: pagePosts.hasNextPage,
        nextPreviewCursor: pagePosts.endCursor,
        previewTotalPages: 0,
        previewPage,
        previewPageSize: PREVIEW_PAGE_SIZE,
        estimatedImportImages: 0,
        estimatedPostCovers: 0,
        estimatedCarouselExtras: 0,
        selectionMode: selection.mode,
        startIndex: selection.startIndex,
        postCount: selection.postCount,
        selectionEndIndex: endSelectionIndex(selection),
        selectionAvailable: true,
      };
    }

    const fetchCount = Math.min(
      50,
      Math.max(PREVIEW_PAGE_SIZE, selection.fetchCount),
    );
    const cacheKey = JSON.stringify({
      username,
      fetchCount,
      timelineOrder,
    });

    let base = this.readCache(cacheKey);
    if (!base) {
      base = await this.fetchInstagramPreviewBase(
        username,
        fetchCount,
        timelineOrder,
      );
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
      instagramUserId: base.instagramUserId,
      profilePicUrlHd: base.profilePicUrlHd,
      profilePicDataUrl: base.profilePicDataUrl,
      mediaCount: base.mediaCount,
      isPrivate: base.isPrivate,
      postsPreview: base.postsPreview,
      postsAvailable: base.postsAvailable,
      timelineOrder: base.timelineOrder,
      hasNextPreviewPage: base.hasNextPreviewPage,
      nextPreviewCursor: base.nextPreviewCursor,
      previewTotalPages: base.previewTotalPages,
      previewPage: 1,
      previewPageSize: PREVIEW_PAGE_SIZE,
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

    const parsedPosts = parseTimelineSampleFromUserNode(
      user,
      Math.min(fetchCount, PREVIEW_PAGE_SIZE),
    );
    const postsPreviewRaw = buildIndexedPostPreview(parsedPosts, timelineOrder, {
      indexStart: 1,
    });
    const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

    const pageInfo = toRecord(edge?.page_info);
    const hasNextPreviewPage = pageInfo?.has_next_page === true;
    const nextPreviewCursor =
      typeof pageInfo?.end_cursor === 'string' && pageInfo.end_cursor.length > 0
        ? pageInfo.end_cursor
        : null;
    const instagramUserId =
      typeof user.id === 'string' && user.id.length > 0 ? user.id : null;
    const previewTotalPages = Math.max(
      1,
      Math.ceil(mediaCount / PREVIEW_PAGE_SIZE),
    );

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
      instagramUserId,
      profilePicUrlHd: hd,
      profilePicDataUrl,
      mediaCount,
      isPrivate: user.is_private === true,
      parsedPosts,
      postsPreview,
      postsAvailable: parsedPosts.length,
      timelineOrder,
      hasNextPreviewPage,
      nextPreviewCursor,
      previewTotalPages,
    };
  }

  private async fetchTimelinePageByCursor(
    userId: string,
    after: string,
    first: number,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    endCursor: string | null;
  }> {
    const variables = JSON.stringify({
      id: userId,
      first,
      after,
    });
    const url = `https://www.instagram.com/graphql/query/?query_id=${IG_GRAPHQL_QUERY_ID}&variables=${encodeURIComponent(variables)}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          ...IG_HEADERS,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Falha de rede ao paginar preview do Instagram.',
      );
    }

    if (res.status === 429) {
      throw new ServiceUnavailableException(
        'Instagram com rate limit no preview. Aguarda ~1 minuto e tenta de novo.',
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Instagram pagination indisponível (HTTP ${res.status}).`,
      );
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const envelope = toRecord(body);
    const data = toRecord(envelope?.data);
    const user = toRecord(data?.user);
    if (!user) {
      throw new ServiceUnavailableException(
        'Resposta de paginação do Instagram inválida.',
      );
    }

    const posts = parseTimelineSampleFromUserNode(user, first);
    const edge = toRecord(user.edge_owner_to_timeline_media);
    const pageInfo = toRecord(edge?.page_info);
    const hasNextPage = pageInfo?.has_next_page === true;
    const endCursor =
      typeof pageInfo?.end_cursor === 'string' && pageInfo.end_cursor.length > 0
        ? pageInfo.end_cursor
        : null;

    return { posts, hasNextPage, endCursor };
  }
}
