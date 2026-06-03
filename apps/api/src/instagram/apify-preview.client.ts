import type { TimelinePostItem } from '@insta2figma/shared-contracts';

export type ApifyPreviewConfig = {
  token: string;
  actorId: string;
  timeoutMs: number;
};

export type ApifyPreviewProfile = {
  username: string;
  instagramUserId: string;
  profilePicUrlHd: string | null;
  mediaCount: number;
  isPrivate: boolean;
  parsedPosts: TimelinePostItem[];
};

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

function parseApifyCarouselUrls(post: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // `images` pode ser string[] ou {url: string, ...}[] conforme versão do actor
  const images = post.images;
  if (Array.isArray(images)) {
    for (const u of images) {
      const s = str(u) ?? str(asRecord(u)?.url) ?? str(asRecord(u)?.displayUrl);
      if (s && !urls.includes(s)) urls.push(s);
    }
  }

  // `childPosts` contém os posts filhos com displayUrl próprio
  const children = post.childPosts;
  if (Array.isArray(children)) {
    for (const c of children) {
      const child = asRecord(c);
      const s = str(child?.displayUrl) ?? str(child?.url) ?? str(child?.imageUrl);
      if (s && !urls.includes(s)) urls.push(s);
    }
  }

  return urls;
}

function mapApifyPost(raw: unknown): TimelinePostItem | null {
  const post = asRecord(raw);
  if (!post) return null;

  const shortcode =
    str(post.shortCode) ?? str(post.shortcode) ?? str(post.code) ?? str(post.id);
  if (!shortcode) return null;

  const type = str(post.type);
  const isVideo =
    type === 'Video' ||
    post.isVideo === true ||
    post.isIgtv === true ||
    post.isReel === true ||
    str(post.videoUrl) !== null ||
    str(post.videoViewCount as unknown) !== null;

  // Apify usa displayUrl como cover principal; fallbacks para outras versões do actor
  const thumbnailUrl =
    str(post.displayUrl) ??
    str(post.thumbnailUrl) ??
    str(post.imageUrl) ??
    str(post.previewUrl);

  const item: TimelinePostItem = {
    shortcode,
    thumbnailUrl,
    isVideo,
  };

  // Carrosséis: Sidecar/GraphSidecar tem imagens filhas em `images` e/ou `childPosts`
  // Detectar também por childPosts.length para compatibilidade com apify~instagram-scraper
  const isCarousel =
    type === 'Sidecar' ||
    type === 'GraphSidecar' ||
    (Array.isArray(post.childPosts) && (post.childPosts as unknown[]).length > 1);
  if (isCarousel) {
    const carousel = parseApifyCarouselUrls(post);
    if (carousel.length > 0) item.carouselImageUrls = carousel;
  }

  return item;
}

function buildApifyConfig(actorId: string): ApifyPreviewConfig {
  return {
    token: process.env.APIFY_TOKEN!.trim(),
    actorId,
    timeoutMs: Math.max(
      30_000,
      Number.parseInt(process.env.APIFY_TIMEOUT_MS ?? '120000', 10) || 120_000,
    ),
  };
}

// Used for the initial profile preview (profile metadata + first ~12 posts).
export function readApifyPreviewConfig(): ApifyPreviewConfig | null {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;
  return buildApifyConfig(
    process.env.APIFY_IG_PROFILE_ACTOR?.trim() || 'apify~instagram-profile-scraper',
  );
}

// Used for pagination (page 2+). Falls back to the profile actor if no post actor is configured.
export function readApifyPostConfig(): ApifyPreviewConfig | null {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;
  return buildApifyConfig(
    process.env.APIFY_IG_POST_ACTOR?.trim() ||
    process.env.APIFY_IG_PROFILE_ACTOR?.trim() ||
    'apify~instagram-profile-scraper',
  );
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

function buildSyncUrl(config: ApifyPreviewConfig): string {
  const actorTimeoutSecs = Math.ceil(config.timeoutMs / 1000);
  const params = new URLSearchParams({
    token: config.token,
    timeout: String(actorTimeoutSecs),
  });
  return `https://api.apify.com/v2/acts/${config.actorId}/run-sync-get-dataset-items?${params.toString()}`;
}

// apify~instagram-profile-scraper: body[0] = profile object with .latestPosts
function parseProfileScraperOutput(
  body: unknown[],
  safeCount: number,
  username: string,
): ApifyPreviewProfile {
  const profileRec = asRecord(body[0]);
  if (!profileRec) throw new Error('Apify response had an unexpected profile shape.');

  if (str(profileRec.error)) throw new Error(`Apify reported: ${str(profileRec.error)}`);

  const instagramUserId = str(profileRec.id) ?? str(profileRec.userId);
  const resolvedUsername = str(profileRec.username) ?? username;
  if (!instagramUserId) throw new Error('Apify response missing a valid user id.');

  const latestPostsRaw = Array.isArray(profileRec.latestPosts)
    ? profileRec.latestPosts
    : Array.isArray(profileRec.posts)
      ? profileRec.posts
      : [];

  const parsedPosts: TimelinePostItem[] = [];
  for (const raw of latestPostsRaw) {
    const item = mapApifyPost(raw);
    if (item) parsedPosts.push(item);
    if (parsedPosts.length >= safeCount) break;
  }

  return {
    username: resolvedUsername,
    instagramUserId,
    profilePicUrlHd:
      str(profileRec.profilePicUrlHD) ??
      str(profileRec.profilePicUrlHd) ??
      str(profileRec.profilePicUrl),
    mediaCount: num(profileRec.postsCount),
    isPrivate: profileRec.private === true || profileRec.isPrivate === true,
    parsedPosts,
  };
}

// apify~instagram-scraper: body = flat array of post objects
function parsePostScraperOutput(
  body: unknown[],
  safeCount: number,
  username: string,
): ApifyPreviewProfile {
  if (body.length === 0) throw new Error('Apify returned no posts for this profile.');

  const firstPost = asRecord(body[0]);
  if (!firstPost) throw new Error('Apify post response had an unexpected shape.');

  const ownerUsername =
    str(firstPost.ownerUsername) ?? str(firstPost.queryUsername) ?? username;
  const ownerId = str(firstPost.ownerId);
  if (!ownerId) throw new Error('Apify post response missing ownerId.');

  const parsedPosts: TimelinePostItem[] = [];
  for (const raw of body) {
    const item = mapApifyPost(raw);
    if (item) parsedPosts.push(item);
    if (parsedPosts.length >= safeCount) break;
  }

  // mediaCount not available from the post scraper; caller computes pagination from parsedPosts.length
  return {
    username: ownerUsername,
    instagramUserId: ownerId,
    profilePicUrlHd: str(firstPost.profilePicUrl) ?? null,
    mediaCount: 0,
    isPrivate: false,
    parsedPosts,
  };
}

export async function fetchPreviewViaApify(
  config: ApifyPreviewConfig,
  username: string,
  fetchCount: number,
): Promise<ApifyPreviewProfile> {
  const safeCount = Math.min(200, Math.max(1, Math.floor(fetchCount)));
  const input = buildActorInput(username, safeCount, config.actorId);

  const tokenPreview = config.token.length > 8
    ? `${config.token.slice(0, 4)}...${config.token.slice(-4)}`
    : '(token curto)';
  console.info(`[apify] a chamar actor=${config.actorId} username=${username} token=${tokenPreview}`);

  let res: Response;
  try {
    res = await fetch(buildSyncUrl(config), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new Error('Network failure or timeout while contacting Apify.');
  }

  console.info(`[apify] resposta status=${res.status} username=${username}`);

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Apify returned HTTP ${res.status} — token=${tokenPreview} actor=${config.actorId}`);
  }
  if (res.status === 429) {
    throw new Error('Apify returned rate limit (429).');
  }
  if (!res.ok) {
    throw new Error(`Apify returned HTTP error ${res.status}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error('Apify returned a non-JSON response.');
  }

  if (!Array.isArray(body) || body.length === 0) {
    throw new Error('Apify returned no profile data for this username.');
  }

  const usePostScraper = isPostScraperActor(config.actorId);
  const profile = usePostScraper
    ? parsePostScraperOutput(body, safeCount, username)
    : parseProfileScraperOutput(body, safeCount, username);

  console.info(
    `[apify] ${profile.parsedPosts.length}/${usePostScraper ? body.length : 'profile'} posts parsed`,
    profile.parsedPosts.slice(0, 5).map(p => ({
      shortcode: p.shortcode,
      thumb: p.thumbnailUrl ? '✓' : '✗',
      carousel: p.carouselImageUrls?.length ?? 0,
      video: p.isVideo,
    })),
  );

  return profile;
}
