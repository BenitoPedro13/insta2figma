import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildIndexedPostPreview,
  endSelectionIndex,
  estimateImportImages,
  parseInstagramUsername,
  parseTimelineSampleFromUserNode,
  PREVIEW_PAGE_SIZE,
  PRO_MAX_PREVIEW_PAGE,
  resolveScrapeSelection,
  type PlanTier,
  type InstagramPostPreviewItem,
  type InstagramPostSummaryItem,
  type ScrapeSelectionInput,
  type TimelinePostItem,
} from '@insta2figma/shared-contracts';
import { SessionPool } from './instagram-session';
import { getProxyAgent } from './instagram-proxy';
import { fetchWithRetry } from './instagram-retry';
import { ScrapeTelemetryService } from './instagram-telemetry.service';

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
const PREVIEW_CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutos — reduz pedidos ao Instagram ~5x
const PREVIEW_THUMB_CONCURRENCY = 4;
const FREE_MAX_PREVIEW_PAGE = 3;

function assertPreviewPageAllowed(planTier: PlanTier, previewPage: number): void {
  if (planTier === 'max') return;
  const maxPage =
    planTier === 'pro' ? PRO_MAX_PREVIEW_PAGE : FREE_MAX_PREVIEW_PAGE;
  if (previewPage > maxPage) {
    throw new BadRequestException(
      planTier === 'free'
        ? 'Preview pagination beyond page 3 requires Pro.'
        : `Preview pagination beyond page ${PRO_MAX_PREVIEW_PAGE} requires Max.`,
    );
  }
}

function normalizeUsername(raw: string): string {
  return parseInstagramUsername(raw);
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

function normalizePreviewCursor(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (isFeedMaxId(text)) return text;
  if (/^\d+$/.test(text)) return text;
  return null;
}

function mergeUniqueTimelinePosts(
  existing: TimelinePostItem[],
  incoming: TimelinePostItem[],
): TimelinePostItem[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((post) => post.shortcode));
  const merged = [...existing];
  for (const post of incoming) {
    if (seen.has(post.shortcode)) continue;
    seen.add(post.shortcode);
    merged.push(post);
  }
  return merged;
}

function pageOneShortcodes(posts: TimelinePostItem[]): Set<string> {
  return new Set(
    posts.slice(0, PREVIEW_PAGE_SIZE).map((post) => post.shortcode),
  );
}

function cachedPreviewPageIsReady(
  posts: TimelinePostItem[],
  pageNumber: number,
): boolean {
  const start = (pageNumber - 1) * PREVIEW_PAGE_SIZE;
  const slice = posts.slice(start, start + PREVIEW_PAGE_SIZE);
  if (slice.length === 0) return false;
  const firstPage = pageOneShortcodes(posts);
  return slice.some((post) => !firstPage.has(post.shortcode));
}

function assertPreviewPageIsNotDuplicate(
  posts: TimelinePostItem[],
  firstPageShortcodes: Set<string>,
): void {
  if (posts.length === 0) return;
  const hasNewPost = posts.some((post) => !firstPageShortcodes.has(post.shortcode));
  if (!hasNewPost) {
    throw new BadRequestException(
      'Could not load the next preview page.',
    );
  }
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

type TelemetryCtx = {
  callerUserId?: string | null;
  planTier?: string | null;
};

@Injectable()
export class InstagramPreviewService {
  private readonly previewCache = new Map<
    string,
    { expiresAt: number; payload: CachedPreviewPayload }
  >();
  private readonly sessionPool = SessionPool.load();

  constructor(private readonly telemetry: ScrapeTelemetryService) {}

  private buildIgHeaders(cookie: string | null): Record<string, string> {
    const headers = { ...IG_HEADERS };
    if (cookie) headers['Cookie'] = cookie;
    return headers;
  }

  async getProfilePreview(
    usernameRaw: string,
    opts?: ScrapeSelectionInput & {
      expandCarouselImages?: boolean;
      previewListSize?: number;
      previewPage?: number;
      after?: string;
      userId?: string;
      planTier?: PlanTier;
      callerUserId?: string;
    },
  ): Promise<ProfilePreviewResponse> {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      throw new BadRequestException('username is required.');
    }

    const previewPage = Math.max(1, Math.floor(opts?.previewPage ?? 1));
    const planTier: PlanTier =
      opts?.planTier === 'max'
        ? 'max'
        : opts?.planTier === 'pro'
          ? 'pro'
          : 'free';
    assertPreviewPageAllowed(planTier, previewPage);

    const selection = resolveScrapeSelection(opts ?? {}, {
      defaultMaxPosts: opts?.maxPosts ?? 12,
    });
    const timelineOrder = selection.timelineOrder;
    const fetchCount = Math.min(
      50,
      Math.max(PREVIEW_PAGE_SIZE, selection.fetchCount),
    );

    const tCtx: TelemetryCtx = {
      callerUserId: opts?.callerUserId ?? null,
      planTier: planTier ?? null,
    };

    if (previewPage > 1) {
      const { base } = await this.getOrFetchPreviewBase(
        username,
        fetchCount,
        timelineOrder,
        tCtx,
      );
      const start = (previewPage - 1) * PREVIEW_PAGE_SIZE;
      const cachedSlice = base.parsedPosts.slice(start, start + PREVIEW_PAGE_SIZE);
      const firstPageShortcodes = pageOneShortcodes(base.parsedPosts);
      const cachedSliceHasNewPosts =
        cachedSlice.length > 0 &&
        cachedSlice.some((post) => !firstPageShortcodes.has(post.shortcode));

      if (cachedSliceHasNewPosts) {
        const hasMoreInCache =
          base.parsedPosts.length > start + cachedSlice.length;
        const hasNextPreviewPage =
          hasMoreInCache || base.hasNextPreviewPage;
        const nextPreviewCursor = hasMoreInCache
          ? null
          : normalizePreviewCursor(base.nextPreviewCursor);

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

      const userId =
        normalizeInstagramUserId(opts?.userId) ?? base.instagramUserId;
      if (!userId) {
        throw new BadRequestException('Preview pagination requires userId.');
      }

      const pagePosts = await this.fetchFeedPageByNumber(
        userId,
        previewPage,
        firstPageShortcodes,
        tCtx,
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
      tCtx,
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
      selectionWarning = `Only ${base.postsAvailable} post(s) visible in preview. Position #${selectionEndIndex} may require loading more posts.`;
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
    ctx: TelemetryCtx,
  ): Promise<{ base: CachedPreviewPayload; cacheKey: string }> {
    const cacheKey = this.buildPreviewCacheKey(username, fetchCount, timelineOrder);
    let base = this.readCache(cacheKey);
    if (base) {
      this.telemetry.record({
        endpoint: 'profile-preview',
        igUsername: username,
        sessionAccount: null,
        proxyUsed: false,
        cacheHit: true,
        statusCode: 200,
        retryCount: 0,
        latencyMs: 0,
        errorKind: null,
        userId: ctx.callerUserId,
        planTier: ctx.planTier,
      });
    } else {
      base = await this.fetchInstagramPreviewBase(username, fetchCount, timelineOrder, ctx);
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
      nextPreviewCursor: normalizePreviewCursor(input.nextPreviewCursor),
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
    if (this.previewCache.size > 512) {
      const oldest = this.previewCache.keys().next().value;
      if (oldest) this.previewCache.delete(oldest);
    }
  }

  private async fetchInstagramPreviewBase(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
    ctx: TelemetryCtx,
  ): Promise<CachedPreviewPayload> {
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const session = this.sessionPool.next();
    const agent = getProxyAgent();
    const t0 = Date.now();

    let res: Response;
    let retryCount = 0;
    try {
      ({ res, retryCount } = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: this.buildIgHeaders(session?.cookie ?? null),
          signal: AbortSignal.timeout(20_000),
          ...(agent ? { dispatcher: agent } : {}),
        },
        'profile-preview',
      ));
    } catch {
      this.telemetry.record({
        endpoint: 'profile-preview',
        igUsername: username,
        sessionAccount: session?.account ?? null,
        proxyUsed: !!agent,
        cacheHit: false,
        statusCode: 0,
        retryCount,
        latencyMs: Date.now() - t0,
        errorKind: 'network',
        userId: ctx.callerUserId,
        planTier: ctx.planTier,
      });
      throw new ServiceUnavailableException(
        'Network failure while fetching Instagram preview.',
      );
    }

    const latencyMs = Date.now() - t0;
    const errorKind = res.status === 429
      ? 'rate_limited'
      : res.status === 404 ? 'not_found'
      : res.status === 401 ? 'auth'
      : !res.ok ? 'unavailable'
      : null;

    this.telemetry.record({
      endpoint: 'profile-preview',
      igUsername: username,
      sessionAccount: session?.account ?? null,
      proxyUsed: !!agent,
      cacheHit: false,
      statusCode: res.status,
      retryCount,
      latencyMs,
      errorKind,
      userId: ctx.callerUserId,
      planTier: ctx.planTier,
    });

    if (res.status === 401 && session) {
      this.sessionPool.markInvalid(session.account);
    }
    if (res.status === 404) {
      throw new BadRequestException('Username not found on Instagram.');
    }
    if (res.status === 429) {
      throw new ServiceUnavailableException(
        'Instagram rate-limited preview requests. Wait about a minute and try again.',
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Instagram preview unavailable (HTTP ${res.status}).`,
      );
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const envelope = toRecord(body);
    const data = toRecord(envelope?.data);
    const user = toRecord(data?.user);
    if (!user) {
      throw new BadRequestException('Instagram profile not found.');
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

    let parsedPosts = parseTimelineSampleFromUserNode(user, fetchCount);
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
    let hasNextPreviewPage =
      parsedPosts.length > PREVIEW_PAGE_SIZE || hasNextFromProfile;
    if (
      instagramUserId &&
      (hasNextFromProfile || mediaCount > PREVIEW_PAGE_SIZE)
    ) {
      try {
        const page1Feed = await this.fetchTimelinePageByFeedMaxId(
          instagramUserId,
          undefined,
          PREVIEW_PAGE_SIZE,
          ctx,
        );
        parsedPosts = mergeUniqueTimelinePosts(parsedPosts, page1Feed.posts);
        nextPreviewCursor = normalizePreviewCursor(page1Feed.nextMaxId);
        hasNextPreviewPage =
          parsedPosts.length > PREVIEW_PAGE_SIZE ||
          Boolean(nextPreviewCursor) ||
          page1Feed.hasNextPage;

        if (nextPreviewCursor && !cachedPreviewPageIsReady(parsedPosts, 2)) {
          try {
            const page2Feed = await this.fetchTimelinePageByFeedMaxId(
              instagramUserId,
              nextPreviewCursor,
              PREVIEW_PAGE_SIZE,
              ctx,
            );
            const merged = mergeUniqueTimelinePosts(parsedPosts, page2Feed.posts);
            if (merged.length > parsedPosts.length) {
              parsedPosts = merged;
              nextPreviewCursor = normalizePreviewCursor(page2Feed.nextMaxId);
              hasNextPreviewPage =
                page2Feed.hasNextPage ||
                Boolean(nextPreviewCursor) ||
                parsedPosts.length < mediaCount;
            }
          } catch {
            // Mantém cursor da página 1; página 2 será resolvida via walk no pedido.
          }
        }
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
    hit.payload.parsedPosts = mergeUniqueTimelinePosts(hit.payload.parsedPosts, posts);
    hit.payload.nextPreviewCursor = normalizePreviewCursor(nextMaxId);
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

  private async fetchFeedPageByNumber(
    userId: string,
    pageNumber: number,
    firstPageShortcodes: Set<string>,
    ctx: TelemetryCtx,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  }> {
    const safePage = Math.max(1, Math.floor(pageNumber));
    let maxId: string | undefined;
    let result: {
      posts: TimelinePostItem[];
      hasNextPage: boolean;
      nextMaxId: string | null;
    } = { posts: [], hasNextPage: false, nextMaxId: null };

    for (let page = 1; page <= safePage; page++) {
      result = await this.fetchTimelinePageByFeedMaxId(
        userId,
        maxId,
        PREVIEW_PAGE_SIZE,
        ctx,
      );
      if (page === safePage) break;
      const next = normalizePreviewCursor(result.nextMaxId);
      if (!next) {
        throw new BadRequestException(
          `Preview page ${page + 1} is not available for this profile.`,
        );
      }
      maxId = next;
    }

    if (safePage > 1) {
      assertPreviewPageIsNotDuplicate(result.posts, firstPageShortcodes);
    }

    return result;
  }

  private async fetchTimelinePageByFeedMaxId(
    userId: string,
    maxId: string | undefined,
    count: number,
    ctx: TelemetryCtx,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  }> {
    const safeCount = Math.min(50, Math.max(1, count));
    const maxIdTrimmed = String(maxId ?? '').trim();
    const qs = new URLSearchParams({ count: String(safeCount) });
    if (maxIdTrimmed) qs.set('max_id', maxIdTrimmed);
    const url = `https://i.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?${qs.toString()}`;

    const session = this.sessionPool.next();
    const agent = getProxyAgent();
    const t0 = Date.now();

    let res: Response;
    let retryCount = 0;
    try {
      ({ res, retryCount } = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: this.buildIgHeaders(session?.cookie ?? null),
          signal: AbortSignal.timeout(20_000),
          ...(agent ? { dispatcher: agent } : {}),
        },
        'feed-pagination',
      ));
    } catch {
      this.telemetry.record({
        endpoint: 'feed-pagination',
        igUsername: userId,
        sessionAccount: session?.account ?? null,
        proxyUsed: !!agent,
        cacheHit: false,
        statusCode: 0,
        retryCount,
        latencyMs: Date.now() - t0,
        errorKind: 'network',
        userId: ctx.callerUserId,
        planTier: ctx.planTier,
      });
      throw new ServiceUnavailableException(
        'Network failure while paginating Instagram preview.',
      );
    }

    const latencyMs = Date.now() - t0;
    const errorKind = res.status === 429
      ? 'rate_limited'
      : res.status === 401 ? 'auth'
      : !res.ok ? 'unavailable'
      : null;

    this.telemetry.record({
      endpoint: 'feed-pagination',
      igUsername: userId,
      sessionAccount: session?.account ?? null,
      proxyUsed: !!agent,
      cacheHit: false,
      statusCode: res.status,
      retryCount,
      latencyMs,
      errorKind,
      userId: ctx.callerUserId,
      planTier: ctx.planTier,
    });

    if (res.status === 401 && session) {
      this.sessionPool.markInvalid(session.account);
    }
    if (res.status === 429) {
      throw new ServiceUnavailableException(
        'Instagram rate-limited preview requests. Wait about a minute and try again.',
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Instagram pagination unavailable (HTTP ${res.status}).`,
      );
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const envelope = toRecord(body);
    const items = envelope?.items;
    const posts = this.parseFeedUserItems(items, safeCount);
    if (posts.length === 0) {
      throw new ServiceUnavailableException(
        'Invalid Instagram pagination response.',
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
