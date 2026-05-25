import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildIndexedPostPreview,
  endSelectionIndex,
  estimateImportImages,
  extractInstagramUserId,
  extractTimelinePageInfo,
  parseTimelineSampleFromUserNode,
  resolveScrapeSelection,
  type InstagramPostPreviewItem,
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
const PREVIEW_PAGE_SIZE = 12;
const IG_TIMELINE_QUERY_HASH = 'e769aa130647d2354c40ea6a439bfc08';

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase();
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

type TimelineSessionCache = {
  expiresAt: number;
  username: string;
  userId: string;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  timelineOrder: 'newest_first' | 'oldest_first';
  pagesParsed: TimelinePostItem[][];
  pagesPreview: InstagramPostPreviewItem[][];
  hasNextPage: boolean;
  nextCursor: string | null;
};

type ProfilePreviewResponse = {
  username: string;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  postsPreview: InstagramPostPreviewItem[];
  postsAvailable: number;
  timelineOrder: 'newest_first' | 'oldest_first';
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  selectionMode: string;
  startIndex: number;
  postCount: number;
  selectionEndIndex: number;
  selectionAvailable: boolean;
  selectionWarning?: string;
  previewPage: number;
  previewPageSize: number;
  hasNextPreviewPage: boolean;
  previewPagesLoaded: number;
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
  private readonly timelineCache = new Map<string, TimelineSessionCache>();

  async getProfilePreview(
    usernameRaw: string,
    opts?: ScrapeSelectionInput & {
      expandCarouselImages?: boolean;
      previewListSize?: number;
      previewPage?: number;
    },
  ): Promise<ProfilePreviewResponse> {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      throw new BadRequestException('username é obrigatório.');
    }

    const selection = resolveScrapeSelection(opts ?? {}, {
      defaultMaxPosts: opts?.maxPosts ?? 12,
    });
    const previewPage = Math.max(1, Math.floor(opts?.previewPage ?? 1));
    const timelineOrder = selection.timelineOrder;
    const cacheKey = `${username}:${timelineOrder}`;

    const session = await this.ensurePreviewPageLoaded(
      cacheKey,
      username,
      previewPage,
      timelineOrder,
    );

    const pageItems = session.pagesPreview[previewPage - 1] ?? [];
    const allParsed = session.pagesParsed.flat();
    const expand = opts?.expandCarouselImages === true;
    const estimate = estimateImportImages(allParsed, selection, expand);

    const selectionEndIndex = endSelectionIndex(selection);
    const postsAvailable = allParsed.length;
    const selectionAvailable = selectionEndIndex <= postsAvailable;
    let selectionWarning: string | undefined;
    if (!selectionAvailable) {
      selectionWarning = `Só ${postsAvailable} post(s) visíveis no preview. A posição #${selectionEndIndex} pode não estar disponível sem paginação extra.`;
    }

    return {
      username: session.username,
      profilePicUrlHd: session.profilePicUrlHd,
      profilePicDataUrl: session.profilePicDataUrl,
      mediaCount: session.mediaCount,
      isPrivate: session.isPrivate,
      postsPreview: pageItems,
      postsAvailable,
      timelineOrder: session.timelineOrder,
      ...estimate,
      selectionMode: selection.mode,
      startIndex: selection.startIndex,
      postCount: selection.postCount,
      selectionEndIndex,
      selectionAvailable,
      previewPage,
      previewPageSize: PREVIEW_PAGE_SIZE,
      hasNextPreviewPage: session.hasNextPage,
      previewPagesLoaded: session.pagesPreview.length,
      ...(selectionWarning ? { selectionWarning } : {}),
    };
  }

  private readTimelineCache(key: string): TimelineSessionCache | null {
    const hit = this.timelineCache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.timelineCache.delete(key);
      return null;
    }
    return hit;
  }

  private writeTimelineCache(key: string, payload: TimelineSessionCache): void {
    this.timelineCache.set(key, {
      ...payload,
      expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
    });
    if (this.timelineCache.size > 64) {
      const oldest = this.timelineCache.keys().next().value;
      if (oldest) this.timelineCache.delete(oldest);
    }
  }

  private async ensurePreviewPageLoaded(
    cacheKey: string,
    username: string,
    previewPage: number,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<TimelineSessionCache> {
    let session = this.readTimelineCache(cacheKey);
    if (!session) {
      session = await this.fetchInstagramPreviewFirstPage(username, timelineOrder);
      this.writeTimelineCache(cacheKey, session);
    }

    while (session.pagesPreview.length < previewPage && session.hasNextPage) {
      if (!session.userId || !session.nextCursor) break;
      const nextPagePosts = await this.fetchInstagramTimelinePage(
        session.userId,
        session.nextCursor,
        PREVIEW_PAGE_SIZE,
      );
      const pageIndex = session.pagesParsed.length;
      const indexOffset = pageIndex * PREVIEW_PAGE_SIZE;
      const previewRaw = buildIndexedPostPreview(
        nextPagePosts.posts,
        timelineOrder,
        indexOffset,
      );
      const preview = await inlinePostsPreviewThumbnails(previewRaw);
      session.pagesParsed.push(nextPagePosts.posts);
      session.pagesPreview.push(preview);
      session.hasNextPage = nextPagePosts.hasNextPage;
      session.nextCursor = nextPagePosts.endCursor;
      this.writeTimelineCache(cacheKey, session);
    }

    if (previewPage > session.pagesPreview.length) {
      throw new BadRequestException(
        `Preview page ${previewPage} indisponível para @${username}.`,
      );
    }

    return session;
  }

  private async fetchInstagramPreviewFirstPage(
    username: string,
    timelineOrder: 'newest_first' | 'oldest_first',
  ): Promise<TimelineSessionCache> {
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

    const userId = extractInstagramUserId(user);
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
    const pageInfo = extractTimelinePageInfo(user);

    const parsedPosts = parseTimelineSampleFromUserNode(user, PREVIEW_PAGE_SIZE);
    const postsPreviewRaw = buildIndexedPostPreview(parsedPosts, timelineOrder, 0);
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
      expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
      username:
        typeof user.username === 'string' && user.username
          ? user.username
          : username,
      userId: userId ?? '',
      profilePicUrlHd: hd,
      profilePicDataUrl,
      mediaCount,
      isPrivate: user.is_private === true,
      timelineOrder,
      pagesParsed: [parsedPosts],
      pagesPreview: [postsPreview],
      hasNextPage: pageInfo.hasNextPage,
      nextCursor: pageInfo.endCursor,
    };
  }

  private async fetchInstagramTimelinePage(
    userId: string,
    after: string,
    pageSize: number,
  ): Promise<{
    posts: TimelinePostItem[];
    endCursor: string | null;
    hasNextPage: boolean;
  }> {
    const variables = JSON.stringify({
      id: userId,
      first: pageSize,
      after,
    });
    const url = `https://www.instagram.com/graphql/query/?query_hash=${IG_TIMELINE_QUERY_HASH}&variables=${encodeURIComponent(variables)}`;

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
    const data = toRecord(envelope?.data);
    const user = toRecord(data?.user);
    if (!user) {
      return { posts: [], endCursor: null, hasNextPage: false };
    }

    const posts = parseTimelineSampleFromUserNode(user, pageSize);
    const pageInfo = extractTimelinePageInfo(user);
    return {
      posts,
      endCursor: pageInfo.endCursor,
      hasNextPage: pageInfo.hasNextPage,
    };
  }
}
