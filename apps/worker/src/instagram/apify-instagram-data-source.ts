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

/**
 * Fonte de fallback baseada no ator `apify/instagram-profile-scraper`.
 * Usa o endpoint síncrono `run-sync-get-dataset-items` (o worker já é assíncrono,
 * então pode bloquear até o ator terminar — tipicamente 20–60s).
 *
 * Custo por chamada = 1 "profile" do ator (cobrança por perfil, não por post),
 * o que mantém o custo por imagem muito abaixo da receita por imagem.
 */
export class ApifyInstagramDataSource implements InstagramDataSource {
  constructor(
    private readonly options: {
      token: string;
      actorId?: string;
      timeoutMs?: number;
    },
  ) {}

  private buildSyncUrl(): string {
    const actorId =
      this.options.actorId?.trim() || 'apify~instagram-profile-scraper';
    const timeoutMs = this.options.timeoutMs ?? 120_000;
    const actorTimeoutSecs = Math.ceil(timeoutMs / 1000);
    const params = new URLSearchParams({
      token: this.options.token,
      timeout: String(actorTimeoutSecs),
    });
    return `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?${params.toString()}`;
  }

  async fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    const selection = resolveScrapeSelection(selectionInput, defaults);
    const timeoutMs = this.options.timeoutMs ?? 120_000;

    const input = {
      usernames: [usernameNormalized],
      resultsLimit: Math.min(50, Math.max(1, selection.fetchCount)),
    };

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

    const profileRec = asRecord(body[0]);
    if (!profileRec) {
      throw new InstagramUpstreamError(
        'IG_PARSE',
        'Apify response had an unexpected profile shape.',
        false,
      );
    }

    // Alguns runs sinalizam erro/privado no próprio item.
    if (str(profileRec.error)) {
      throw new InstagramUpstreamError(
        'IG_BLOCKED',
        `Apify reported: ${str(profileRec.error)}`,
        false,
      );
    }

    const profile = mapApifyProfile(profileRec);

    const latestPostsRaw = Array.isArray(profileRec.latestPosts)
      ? profileRec.latestPosts
      : Array.isArray(profileRec.posts)
        ? profileRec.posts
        : [];

    const fetched: InstagramPostSummaryItem[] = [];
    for (const raw of latestPostsRaw) {
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
