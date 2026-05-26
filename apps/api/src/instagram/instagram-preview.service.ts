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
const FREE_MAX_PREVIEW_PAGE = 3;

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase();
}

function normalizeInstagramUserId(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return String(Math.floor(raw));
  }
  return null;
}

function isFeedMaxId(value: string): boolean {
  return /^\d+_\d+$/.test(value.trim());
}

function estimateProfileImageCount(
  parsedPosts: InstagramPostSummaryItem[],
  mediaCount: number,
  timelineOrder: 'newest_first' | 'oldest_first',
): number {
  if (mediaCount <= 0 || parsedPosts.length === 0) return 0;

  const selection = resolveScrapeSelection(
    {
      selectionMode: 'recent',
      startIndex: 1,
      postCount: parsedPosts.length,
      timelineOrder,
      maxPosts: mediaCount,
    },
    { defaultMaxPosts: mediaCount },
  );
  const sampleImages = estimateImportImages(
    parsedPosts,
    selection,
    true,
  ).estimatedImportImages;

  if (parsedPosts.length >= mediaCount) return sampleImages;
  return Math.max(
    sampleImages,
    Math.round(sampleImages * (mediaCount / parsedPosts.length)),
  );
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
  imageCount: number;
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
    const fetchCount = Math.min(
      50,
      Math.max(PREVIEW_PAGE_SIZE, selection.fetchCount),
    );

    if (previewPage > 1) {
      const { base } = await this.getOrFetchPreviewBase(
        username,
        fetchCount,
        timelineOrder,
      );
      const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
      const cachedSlice = base.parsedPosts.slice(start, start + PREVIEW_PAGE_SIZE);

      if (cachedSlice.length > 0) {
        const hasMoreInCache =
          base.parsedPosts.length > start + cachedSlice.length;
        const hasNextPreviewPage =
          hasMoreInCache || base.hasNextPreviewPage;
        const nextPreviewCursor = hasMoreInCache
          ? null
          : base.nextPreviewCursor;

        return this.buildPaginatedPreviewResponse({
          username: base.username,
          instagramUserId: base.instagramUserId,
          previewPage,
          timelineOrder,
          selection,
          posts: cachedSlice,
          previewTotalPages: base.previewTotalPages,
          hasNextPreviewPage,
          nextPreviewCursor,
        });
      }

      const requestedAfter = String(opts?.after ?? '').trim();
      const after =
        (isFeedMaxId(requestedAfter) ? requestedAfter : '') ||
        base.nextPreviewCursor ||
        '';
      const userId =
        normalizeInstagramUserId(opts?.userId) ?? base.instagramUserId;
      if (!after || !userId) {
        throw new BadRequestException(
          'Paginação do preview requer userId e after.',
        );
      }

      const pagePosts = await this.fetchTimelinePageByFeedMaxId(
        userId,
        after,
        PREVIEW_PAGE_SIZE,
      );
      this.appendPostsToCache(
        this.buildPreviewCacheKey(username, fetchCount, timelineOrder),
        pagePosts.posts,
        pagePosts.nextMaxId,
        pagePosts.hasNextPage,
      );
      return this.buildPaginatedPreviewResponse({
        username: base.username,
        instagramUserId: userId,
        previewPage,
        timelineOrder,
        selection,
        posts: pagePosts.posts,
        previewTotalPages: base.previewTotalPages,
        hasNextPreviewPage: pagePosts.hasNextPage,
        nextPreviewCursor: pagePosts.nextMaxId,
      });
    }

    const { base } = await this.getOrFetchPreviewBase(
      username,
      fetchCount,
      timelineOrder,
    );

    const expand = opts?.expandCarouselImages === true;
    const estimate = estimateImportImages(base.parsedPosts, selection, expand);
    const imageCount = estimateProfileImageCount(
      base.parsedPosts,
      base.mediaCount,
      timelineOrder,
    );

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
      postsAvailable: base.parsedPosts.length,
      timelineOrder: base.timelineOrder,
      hasNextPreviewPage:
        base.parsedPosts.length > PREVIEW_PAGE_SIZE || base.hasNextPreviewPage,
      nextPreviewCursor: base.nextPreviewCursor,
      previewTotalPages: base.previewTotalPages,
      previewPage: 1,
      previewPageSize: PREVIEW_PAGE_SIZE,
      imageCount,
      ...estimate,
      selectionMode: selection.mode,
      startIndex: selection.startIndex,
      postCount: selection.postCount,
      selectionEndIndex,
      selectionAvailable,
      ...(selectionWarning ? { selectionWarning } : {}),
    };
  }

  private buildPreviewCacheKey(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): string {
    return JSON.stringify({ username, fetchCount, timelineOrder });
  }

  private async getOrFetchPreviewBase(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<{ base: CachedPreviewPayload; cacheKey: string }> {
    const cacheKey = this.buildPreviewCacheKey(username, fetchCount, timelineOrder);
    let base = this.readCache(cacheKey);
    if (!base) {
      base = await this.fetchInstagramPreviewBase(
        username,
        fetchCount,
        timelineOrder,
      );
      this.writeCache(cacheKey, base);
    }
    return { base, cacheKey };
  }

  private async buildPaginatedPreviewResponse(input: {
    username: string;
    instagramUserId: string | null;
    previewPage: number;
    timelineOrder: 'newest_first' | 'oldest_first';
    selection: ReturnType<typeof resolveScrapeSelection>;
    posts: TimelinePostItem[];
    previewTotalPages: number;
    hasNextPreviewPage: boolean;
    nextPreviewCursor: string | null;
  }): Promise<ProfilePreviewResponse> {
    const postsPreviewRaw = buildIndexedPostPreview(
      input.posts,
      input.timelineOrder,
      { indexStart: (input.previewPage - 1) * PREVIEW_PAGE_SIZE + 1 },
    );
    const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

    return {
      username: input.username,
      instagramUserId: input.instagramUserId,
      profilePicUrlHd: null,
      profilePicDataUrl: null,
      mediaCount: 0,
      isPrivate: false,
      postsPreview,
      postsAvailable: postsPreview.length,
      timelineOrder: input.timelineOrder,
      hasNextPreviewPage: input.hasNextPreviewPage,
      nextPreviewCursor: input.nextPreviewCursor,
      previewTotalPages: input.previewTotalPages,
      previewPage: input.previewPage,
      previewPageSize: PREVIEW_PAGE_SIZE,
      imageCount: 0,
      estimatedImportImages: 0,
      estimatedPostCovers: 0,
      estimatedCarouselExtras: 0,
      selectionMode: input.selection.mode,
      startIndex: input.selection.startIndex,
      postCount: input.selection.postCount,
      selectionEndIndex: endSelectionIndex(input.selection),
      selectionAvailable: true,
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
    const pageOnePosts = parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
    const postsPreviewRaw = buildIndexedPostPreview(pageOnePosts, timelineOrder, {
      indexStart: 1,
    });
    const postsPreview = await inlinePostsPreviewThumbnails(postsPreviewRaw);

    const pageInfo = toRecord(edge?.page_info);
    const hasNextFromProfile = pageInfo?.has_next_page === true;
    const instagramUserId = normalizeInstagramUserId(user.id);
    const previewTotalPages = Math.max(
      1,
      Math.ceil(mediaCount / PREVIEW_PAGE_SIZE),
    );

    let nextPreviewCursor: string | null = null;
    let hasNextPreviewPage = parsedPosts.length > PREVIEW_PAGE_SIZE || hasNextFromProfile;
    if (instagramUserId && hasNextFromProfile) {
      try {
        const feedHead = await this.fetchTimelinePageByFeedMaxId(
          instagramUserId,
          undefined,
          PREVIEW_PAGE_SIZE,
        );
        nextPreviewCursor = feedHead.nextMaxId;
        hasNextPreviewPage = Boolean(nextPreviewCursor) || feedHead.hasNextPage;
      } catch {
        nextPreviewCursor = null;
      }
    }

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

  private appendPostsToCache(
    cacheKey: string,
    posts: TimelinePostItem[],
    nextMaxId: string | null,
    hasNextPage: boolean,
  ): void {
    const hit = this.previewCache.get(cacheKey);
    if (!hit || posts.length === 0) return;
    hit.payload.parsedPosts = [...hit.payload.parsedPosts, ...posts];
    hit.payload.nextPreviewCursor = nextMaxId;
    hit.payload.hasNextPreviewPage =
      hasNextPage ||
      hit.payload.parsedPosts.length < hit.payload.mediaCount;
  }

  private parseFeedUserItems(
    itemsRaw: unknown,
    maxPosts: number,
  ): TimelinePostItem[] {
    if (!Array.isArray(itemsRaw)) return [];
    const out: TimelinePostItem[] = [];
    for (const raw of itemsRaw) {
      const item = toRecord(raw);
      if (!item) continue;
      const shortcode =
        typeof item.code === 'string' && item.code.length > 0
          ? item.code
          : null;
      if (!shortcode) continue;

      let thumbnailUrl: string | null = null;
      const imageVersions = toRecord(item.image_versions2);
      const candidates = imageVersions?.candidates;
      if (Array.isArray(candidates)) {
        for (const candidateRaw of candidates) {
          const candidate = toRecord(candidateRaw);
          const url = candidate?.url;
          if (typeof url === 'string' && url.length > 0) {
            thumbnailUrl = url;
            break;
          }
        }
      }
      if (
        !thumbnailUrl &&
        typeof item.display_uri === 'string' &&
        item.display_uri.length > 0
      ) {
        thumbnailUrl = item.display_uri;
      }

      const mediaType = item.media_type;
      const isVideo = mediaType === 2;

      const parsed: TimelinePostItem = {
        shortcode,
        thumbnailUrl,
        isVideo,
      };
      out.push(parsed);
      if (out.length >= maxPosts) break;
    }
    return out;
  }

  private async fetchTimelinePageByFeedMaxId(
    userId: string,
    maxId: string | undefined,
    count: number,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  }> {
    const safeCount = Math.min(50, Math.max(1, count));
    const maxIdTrimmed = String(maxId ?? '').trim();
    const qs = new URLSearchParams({
      count: String(safeCount),
    });
    if (maxIdTrimmed) {
      qs.set('max_id', maxIdTrimmed);
    }
    const url = `https://i.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?${qs.toString()}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: IG_HEADERS,
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
    const items = envelope?.items;
    const posts = this.parseFeedUserItems(items, safeCount);
    if (posts.length === 0) {
      throw new ServiceUnavailableException(
        'Resposta de paginação do Instagram inválida.',
      );
    }

    const nextMaxIdRaw = envelope?.next_max_id;
    const nextMaxId =
      (typeof nextMaxIdRaw === 'string' && nextMaxIdRaw.length > 0
        ? nextMaxIdRaw
        : typeof nextMaxIdRaw === 'number' && Number.isFinite(nextMaxIdRaw)
          ? String(nextMaxIdRaw)
          : null);
    const hasNextPage = envelope?.more_available === true;

    return { posts, hasNextPage, nextMaxId };
  }
}
