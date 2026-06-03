import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
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
  type InstagramPostSummaryItem,
  type ScrapeSelectionInput,
  type TimelinePostItem,
} from '@insta2figma/shared-contracts';
import { globalSessionPool, getProxyAgent, buildProxyAgent, fetchWithRetry, PREVIEW_RETRY, parseFeedItems, IG_HEADERS, buildIgHeaders } from '@insta2figma/shared-instagram';
import { REDIS_CACHE_CLIENT } from '../cache/redis-cache.module';
import { ScrapeTelemetryService } from './instagram-telemetry.service';
import { fetchPreviewViaApify, readApifyPreviewConfig, readApifyPostConfig } from './apify-preview.client';
import { fetchInstagramImageAsDataUrl } from './instagram-image.utils';
import type { CachedPreviewPayload, TelemetryCtx, PreviewDataSource } from './preview-source.types';
import { ApifyPreviewSource } from './apify-preview-source';
import { FallbackPreviewSource } from './fallback-preview-source';

const MAX_AVATAR_BYTES = 900_000;
// TTL total no Redis: 15 minutos. Dados frescos até 5 min; dos 5–15 min servem stale
// enquanto uma revalidação corre em background (stale-while-revalidate).
const PREVIEW_CACHE_TTL_MS = 15 * 60 * 1_000;
const PREVIEW_REVALIDATE_AFTER_MS = 5 * 60 * 1_000;
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

// Subconjunto sem campos derivados com base64 — o que fica guardado no Redis.
type RedisCachedPreviewPayload = Omit<CachedPreviewPayload, 'profilePicDataUrl' | 'postsPreview'> & {
  cachedAt: number; // timestamp ms — usado para stale-while-revalidate
  // cursor para cada página adicional: key = página destino (ex: "2" → cursor para começar página 2)
  pageCursors?: Record<string, string>;
};

function toRedisCachedPayload(p: CachedPreviewPayload): RedisCachedPreviewPayload {
  const { profilePicDataUrl: _d, postsPreview: _p, ...rest } = p;
  return { ...rest, cachedAt: Date.now() };
}


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


@Injectable()
export class InstagramPreviewService {
  private readonly sessionPool = globalSessionPool;
  /** Chaves de cache com revalidação em background a decorrer — evita fetches duplicados. */
  private readonly revalidating = new Set<string>();
  private readonly previewSource: PreviewDataSource;

  constructor(
    private readonly telemetry: ScrapeTelemetryService,
    @Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis,
  ) {
    this.previewSource = this.buildPreviewSource();
  }

  private buildPreviewSource(): PreviewDataSource {
    const direct: PreviewDataSource = {
      name: 'instagram-direct',
      fetchPreview: (username, fetchCount, timelineOrder, ctx) =>
        this.fetchInstagramPreviewDirect(username, fetchCount, timelineOrder, ctx ?? { callerUserId: null, planTier: null }),
    };

    const config = readApifyPreviewConfig();
    if (!config) return direct;

    return new FallbackPreviewSource(direct, [new ApifyPreviewSource(config)]);
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

      const cachedCursor = normalizePreviewCursor(
        (base as unknown as RedisCachedPreviewPayload).pageCursors?.[String(previewPage)] ?? null,
      ) ?? undefined;
      const pagePosts = await this.fetchFeedPageByNumber(
        userId,
        previewPage,
        firstPageShortcodes,
        tCtx,
        username,
        cachedCursor,
      );
      await this.appendPostsToCache(
        this.buildPreviewCacheKey(username, fetchCount, timelineOrder),
        pagePosts.posts,
        pagePosts.nextMaxId,
        pagePosts.hasNextPage,
        previewPage,
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
    const cached = await this.readCache(cacheKey);
    if (cached) {
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

      // Stale-while-revalidate: dados com mais de PREVIEW_REVALIDATE_AFTER_MS
      // são servidos imediatamente mas actualizam-se em background.
      const ageMs = Date.now() - (cached.cachedAt ?? 0);
      if (ageMs > PREVIEW_REVALIDATE_AFTER_MS && !this.revalidating.has(cacheKey)) {
        this.revalidating.add(cacheKey);
        void this.fetchInstagramPreviewBase(username, fetchCount, timelineOrder, ctx)
          .then((fresh) => this.writeCache(cacheKey, toRedisCachedPayload(fresh)))
          .catch(() => {})
          .finally(() => this.revalidating.delete(cacheKey));
      }

      const pageOnePosts = cached.parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
      const postsPreview = buildIndexedPostPreview(pageOnePosts, cached.timelineOrder, { indexStart: 1 });
      return {
        cacheKey,
        base: { ...cached, profilePicDataUrl: null, postsPreview },
      };
    }
    const base = await this.fetchInstagramPreviewBase(username, fetchCount, timelineOrder, ctx);
    await this.writeCache(cacheKey, toRedisCachedPayload(base));
    return { base, cacheKey };
  }

  private async fetchFeedPageViaApify(
    username: string,
    pageNumber: number,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  } | null> {
    const config = readApifyPostConfig();
    if (!config) return null;

    const neededPosts = Math.min(200, pageNumber * PREVIEW_PAGE_SIZE);
    try {
      const apify = await fetchPreviewViaApify(config, username, neededPosts);
      const start = (pageNumber - 1) * PREVIEW_PAGE_SIZE;
      const posts = apify.parsedPosts.slice(start, start + PREVIEW_PAGE_SIZE);
      if (posts.length === 0) return null;

      const hasNextPage =
        apify.parsedPosts.length > start + posts.length ||
        (apify.mediaCount > 0 && apify.mediaCount > start + posts.length) ||
        (apify.mediaCount === 0 && apify.parsedPosts.length >= neededPosts);

      return { posts, hasNextPage, nextMaxId: null };
    } catch (err) {
      console.warn(
        '[preview] paginação Apify falhou.',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
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
    const postsPreview = buildIndexedPostPreview(
      input.posts,
      input.timelineOrder,
      { indexStart: (input.previewPage - 1) * PREVIEW_PAGE_SIZE + 1 },
    );

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

  private async readCache(key: string): Promise<RedisCachedPreviewPayload | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as RedisCachedPreviewPayload;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, payload: RedisCachedPreviewPayload): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(payload),
        'EX',
        Math.floor(PREVIEW_CACHE_TTL_MS / 1000),
      );
    } catch {
      // Redis indisponível — degradação silenciosa
    }
  }

  private fetchInstagramPreviewBase(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
    ctx: TelemetryCtx,
  ): Promise<CachedPreviewPayload> {
    return this.previewSource.fetchPreview(username, fetchCount, timelineOrder, ctx);
  }

  private async fetchInstagramPreviewDirect(
    username: string,
    fetchCount: number,
    timelineOrder: 'newest_first' | 'oldest_first',
    ctx: TelemetryCtx,
  ): Promise<CachedPreviewPayload> {
    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    const session = this.sessionPool.next();
    const agent = session?.proxy ? buildProxyAgent(session.proxy) ?? getProxyAgent() : getProxyAgent();
    const t0 = Date.now();

    console.info(
      `[ig:req] profile-preview @${username} proxy=${agent ? 'yes' : 'no'} session=${session?.account ?? 'none'}`,
    );

    let res: Response;
    let retryCount = 0;
    try {
      ({ res, retryCount } = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: buildIgHeaders(session?.cookie),
          signal: AbortSignal.timeout(20_000),
          ...(agent ? { dispatcher: agent } : {}),
        },
        'profile-preview',
        PREVIEW_RETRY,
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
    console.info(
      `[ig:res] profile-preview @${username} status=${res.status} retries=${retryCount} latency=${latencyMs}ms`,
    );
    const errorKind = res.status === 429
      ? 'rate_limited'
      : res.status === 404 ? 'not_found'
      : (res.status === 401 || res.status === 400) ? 'auth'
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

    // 400 com sessão activa = cookie expirado/bloqueado (Instagram devolve 400 em vez de 401)
    if ((res.status === 401 || res.status === 400) && session) {
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
    let profilePicDataUrl: string | null = null;

    if (
      instagramUserId &&
      (hasNextFromProfile || mediaCount > PREVIEW_PAGE_SIZE || parsedPosts.length === 0)
    ) {
      // feed page 1 e avatar em paralelo — ambos dependem apenas de web_profile_info
      const [page1Result, avatarResult] = await Promise.allSettled([
        this.fetchTimelinePageByFeedMaxId(instagramUserId, undefined, PREVIEW_PAGE_SIZE, ctx),
        hd ? fetchInstagramImageAsDataUrl(hd, MAX_AVATAR_BYTES) : Promise.resolve(null),
      ]);

      if (page1Result.status === 'fulfilled') {
        const page1Feed = page1Result.value;
        parsedPosts = mergeUniqueTimelinePosts(parsedPosts, page1Feed.posts);
        nextPreviewCursor = normalizePreviewCursor(page1Feed.nextMaxId);
        hasNextPreviewPage =
          parsedPosts.length > PREVIEW_PAGE_SIZE ||
          Boolean(nextPreviewCursor) ||
          page1Feed.hasNextPage;
      }

      if (avatarResult.status === 'fulfilled') {
        profilePicDataUrl = avatarResult.value;
      }
      // Página 2 não é pré-carregada — carregada sob pedido quando o utilizador navegar
    } else if (hd) {
      profilePicDataUrl = await fetchInstagramImageAsDataUrl(hd, MAX_AVATAR_BYTES);
    }

    // postsPreview com CDN URLs directas — download/conversão feita no browser via <img>
    const pageOnePosts = parsedPosts.slice(0, PREVIEW_PAGE_SIZE);
    const postsPreview = buildIndexedPostPreview(pageOnePosts, timelineOrder, {
      indexStart: 1,
    });
    console.info(`[ig:thumbs] ${postsPreview.length} posts, ${postsPreview.filter(p => !!p.thumbnailUrl).length} com URL de thumbnail`);

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

  private async appendPostsToCache(
    cacheKey: string,
    posts: TimelinePostItem[],
    nextMaxId: string | null,
    hasNextPage: boolean,
    fetchedPage?: number,
  ): Promise<void> {
    if (posts.length === 0) return;
    try {
      const raw = await this.redis.get(cacheKey);
      if (!raw) return;
      const cached = JSON.parse(raw) as RedisCachedPreviewPayload;
      const ttl = await this.redis.ttl(cacheKey);
      if (ttl <= 0) return;
      cached.parsedPosts = mergeUniqueTimelinePosts(cached.parsedPosts, posts);
      cached.nextPreviewCursor = normalizePreviewCursor(nextMaxId);
      cached.hasNextPreviewPage =
        hasNextPage || cached.parsedPosts.length < cached.mediaCount;
      // Guardar cursor para a próxima página — permite saltar directamente sem recomeçar do início
      if (fetchedPage && nextMaxId) {
        cached.pageCursors = { ...(cached.pageCursors ?? {}), [String(fetchedPage + 1)]: nextMaxId };
      }
      await this.redis.set(cacheKey, JSON.stringify(cached), 'EX', ttl);
    } catch {
      // Redis indisponível — saltar actualização de cache
    }
  }

  private async fetchFeedPageByNumber(
    userId: string,
    pageNumber: number,
    firstPageShortcodes: Set<string>,
    ctx: TelemetryCtx,
    username?: string,
    cachedCursor?: string,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  }> {
    try {
      return await this.fetchFeedPageByNumberDirect(
        userId,
        pageNumber,
        firstPageShortcodes,
        ctx,
        cachedCursor,
      );
    } catch (err) {
      if (username) {
        const apifyPage = await this.fetchFeedPageViaApify(username, pageNumber);
        if (apifyPage) {
          if (pageNumber > 1) {
            assertPreviewPageIsNotDuplicate(apifyPage.posts, firstPageShortcodes);
          }
          console.info('[preview] paginação via fallback Apify teve sucesso.');
          return apifyPage;
        }
      }
      throw err;
    }
  }

  private async fetchFeedPageByNumberDirect(
    userId: string,
    pageNumber: number,
    firstPageShortcodes: Set<string>,
    ctx: TelemetryCtx,
    cachedCursor?: string,
  ): Promise<{
    posts: TimelinePostItem[];
    hasNextPage: boolean;
    nextMaxId: string | null;
  }> {
    const safePage = Math.max(1, Math.floor(pageNumber));
    // Se temos cursor em cache para esta página, saltamos directamente — 1 chamada ao invés de N.
    const resumePage = cachedCursor ? safePage : 1;
    let maxId: string | undefined = cachedCursor ?? undefined;
    let result: {
      posts: TimelinePostItem[];
      hasNextPage: boolean;
      nextMaxId: string | null;
    } = { posts: [], hasNextPage: false, nextMaxId: null };

    for (let page = resumePage; page <= safePage; page++) {
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
    const agent = session?.proxy ? buildProxyAgent(session.proxy) ?? getProxyAgent() : getProxyAgent();
    const t0 = Date.now();

    console.info(
      `[ig:req] feed-pagination userId=${userId} proxy=${agent ? 'yes' : 'no'} session=${session?.account ?? 'none'}`,
    );

    let res: Response;
    let retryCount = 0;
    try {
      ({ res, retryCount } = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: buildIgHeaders(session?.cookie),
          signal: AbortSignal.timeout(20_000),
          ...(agent ? { dispatcher: agent } : {}),
        },
        'feed-pagination',
        PREVIEW_RETRY,
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
    console.info(
      `[ig:res] feed-pagination userId=${userId} status=${res.status} retries=${retryCount} latency=${latencyMs}ms`,
    );
    const errorKind = res.status === 429
      ? 'rate_limited'
      : (res.status === 401 || res.status === 400) ? 'auth'
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

    if ((res.status === 401 || res.status === 400) && session) {
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
    const posts = parseFeedItems(items, safeCount);
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
