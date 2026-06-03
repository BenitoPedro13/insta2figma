import type {
  InstagramPostSummaryItem,
  InstagramProfileSummary,
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { resolveScrapeSelection, slicePostsBySelection } from '@insta2figma/shared-contracts';
import { InstagramUpstreamError } from './instagram-upstream-error';
import type { InstagramDataSource } from './http-instagram-data-source';

function asRecord(o: unknown): Record<string, unknown> | null {
  return o !== null && typeof o === 'object' && !Array.isArray(o)
    ? (o as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Extrai as URLs adicionais de um post carrossel (sidecar) do Apify.
 * O ator pode devolver `images: string[]` e/ou `childPosts: [{ displayUrl }]`,
 * conforme a versão. Coletamos ambos de forma defensiva (dedup no upload).
 */
function parseApifyCarouselUrls(post: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const images = post.images;
  if (Array.isArray(images)) {
    for (const u of images) {
      const s = str(u);
      if (s && !urls.includes(s)) urls.push(s);
    }
  }
  const children = post.childPosts;
  if (Array.isArray(children)) {
    for (const c of children) {
      const child = asRecord(c);
      const s = str(child?.displayUrl) ?? str(child?.url);
      if (s && !urls.includes(s)) urls.push(s);
    }
  }
  return urls;
}

function mapApifyPostToSummaryItem(
  raw: unknown,
): InstagramPostSummaryItem | null {
  const post = asRecord(raw);
  if (!post) return null;

  const shortcode = str(post.shortCode) ?? str(post.shortcode) ?? str(post.code);
  if (!shortcode) return null;

  const type = str(post.type);
  const isVideo =
    type === 'Video' ||
    post.isVideo === true ||
    str(post.videoUrl) !== null;

  const thumbnailUrl =
    str(post.displayUrl) ?? str(post.thumbnailUrl) ?? str(post.imageUrl);

  const item: InstagramPostSummaryItem = {
    shortcode,
    thumbnailUrl,
    isVideo,
  };

  if (type === 'Sidecar') {
    const carousel = parseApifyCarouselUrls(post);
    if (carousel.length > 0) item.carouselImageUrls = carousel;
  }

  return item;
}

function mapApifyProfile(
  profile: Record<string, unknown>,
): InstagramProfileSummary {
  const id = str(profile.id) ?? str(profile.userId);
  const username = str(profile.username);
  if (!id) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Apify response missing a valid user id.',
      false,
    );
  }
  if (!username) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Apify response missing a valid username.',
      false,
    );
  }

  return {
    id,
    username,
    fullName: str(profile.fullName),
    biography: str(profile.biography),
    followerCount: num(profile.followersCount),
    followingCount: num(profile.followsCount),
    mediaCount: num(profile.postsCount),
    isPrivate: profile.private === true || profile.isPrivate === true,
    isVerified: profile.verified === true || profile.isVerified === true,
    profilePicUrlHd:
      str(profile.profilePicUrlHD) ??
      str(profile.profilePicUrlHd) ??
      str(profile.profilePicUrl),
  };
}

// apify~instagram-scraper uses directUrls+resultsType; apify~instagram-profile-scraper uses usernames.
function isPostScraperActor(actorId: string): boolean {
  return !actorId.toLowerCase().includes('profile-scraper');
}

function buildActorInput(username: string, safeCount: number, actorId: string): unknown {
  if (isPostScraperActor(actorId)) {
    return {
      directUrls: [`https://www.instagram.com/${username}/`],
      resultsType: 'posts',
      resultsLimit: safeCount,
    };
  }
  return {
    usernames: [username],
    resultsLimit: safeCount,
  };
}

function mapProfileFromPostItem(
  firstPost: Record<string, unknown>,
  username: string,
): InstagramProfileSummary {
  const id = str(firstPost.ownerId);
  const resolvedUsername = str(firstPost.ownerUsername) ?? str(firstPost.queryUsername) ?? username;
  if (!id) {
    throw new InstagramUpstreamError('IG_PARSE', 'Apify post response missing ownerId.', false);
  }
  return {
    id,
    username: resolvedUsername,
    fullName: str(firstPost.ownerFullName),
    biography: null,
    followerCount: 0,
    followingCount: 0,
    mediaCount: 0,
    isPrivate: false,
    isVerified: false,
    profilePicUrlHd: str(firstPost.profilePicUrl),
  };
}

/**
 * Fonte de fallback baseada num ator Apify de Instagram.
 * Suporta `apify~instagram-profile-scraper` (input: usernames) e
 * `apify~instagram-scraper` (input: directUrls, output: flat post array).
 */
export class ApifyInstagramDataSource implements InstagramDataSource {
  constructor(
    private readonly options: {
      token: string;
      actorId?: string;
      timeoutMs?: number;
    },
  ) {}

  private get actorId(): string {
    return this.options.actorId?.trim() || 'apify~instagram-profile-scraper';
  }

  private buildSyncUrl(): string {
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const actorTimeoutSecs = Math.ceil(timeoutMs / 1000);
    const params = new URLSearchParams({
      token: this.options.token,
      timeout: String(actorTimeoutSecs),
    });
    return `https://api.apify.com/v2/acts/${this.actorId}/run-sync-get-dataset-items?${params.toString()}`;
  }

  async fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    const selection = resolveScrapeSelection(selectionInput, defaults);
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const safeCount = Math.min(200, Math.max(1, selection.fetchCount));
    const input = buildActorInput(usernameNormalized, safeCount, this.actorId);

    let res: Response;
    try {
      res = await fetch(this.buildSyncUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new InstagramUpstreamError(
        'IG_UPSTREAM',
        'Network failure or timeout while contacting Apify.',
        true,
        { cause: e },
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new InstagramUpstreamError(
        'IG_BLOCKED',
        `Apify returned HTTP ${res.status} (check APIFY_TOKEN).`,
        false,
      );
    }
    if (res.status === 429) {
      throw new InstagramUpstreamError(
        'IG_RATE_LIMIT',
        'Apify returned rate limit (429).',
        true,
      );
    }
    if (!res.ok) {
      throw new InstagramUpstreamError(
        'IG_UPSTREAM',
        `Apify returned HTTP error ${res.status}.`,
        true,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      throw new InstagramUpstreamError(
        'IG_PARSE',
        'Apify returned a non-JSON response.',
        false,
        { cause: e },
      );
    }

    if (!Array.isArray(body) || body.length === 0) {
      throw new InstagramUpstreamError(
        'IG_NOT_FOUND',
        'Apify returned no profile data for this username.',
        false,
      );
    }

    let profile: InstagramProfileSummary;
    let postsRaw: unknown[];

    if (isPostScraperActor(this.actorId)) {
      // Flat array of post objects — extract profile info from first item
      const firstPost = asRecord(body[0]);
      if (!firstPost) {
        throw new InstagramUpstreamError('IG_PARSE', 'Apify post response had unexpected shape.', false);
      }
      profile = mapProfileFromPostItem(firstPost, usernameNormalized);
      postsRaw = body;
    } else {
      // Profile scraper — body[0] = profile object with latestPosts
      const profileRec = asRecord(body[0]);
      if (!profileRec) {
        throw new InstagramUpstreamError('IG_PARSE', 'Apify response had an unexpected profile shape.', false);
      }
      if (str(profileRec.error)) {
        throw new InstagramUpstreamError('IG_BLOCKED', `Apify reported: ${str(profileRec.error)}`, false);
      }
      profile = mapApifyProfile(profileRec);
      postsRaw = Array.isArray(profileRec.latestPosts)
        ? profileRec.latestPosts
        : Array.isArray(profileRec.posts)
          ? profileRec.posts
          : [];
    }

    const fetched: InstagramPostSummaryItem[] = [];
    for (const raw of postsRaw) {
      const item = mapApifyPostToSummaryItem(raw);
      if (item) fetched.push(item);
      if (fetched.length >= selection.fetchCount) break;
    }

    const postsSample = slicePostsBySelection(fetched, selection);

    return {
      phase: 5,
      source: 'instagram_web_profile_info',
      username: usernameNormalized,
      profile,
      postsSample,
    };
  }
}
