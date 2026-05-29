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

function mapApifyPost(raw: unknown): TimelinePostItem | null {
  const post = asRecord(raw);
  if (!post) return null;

  const shortcode = str(post.shortCode) ?? str(post.shortcode) ?? str(post.code);
  if (!shortcode) return null;

  const type = str(post.type);
  const isVideo =
    type === 'Video' || post.isVideo === true || str(post.videoUrl) !== null;

  const thumbnailUrl =
    str(post.displayUrl) ?? str(post.thumbnailUrl) ?? str(post.imageUrl);

  const item: TimelinePostItem = {
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

export function readApifyPreviewConfig(): ApifyPreviewConfig | null {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return null;

  return {
    token,
    actorId:
      process.env.APIFY_IG_PROFILE_ACTOR?.trim() ||
      'apify~instagram-profile-scraper',
    timeoutMs: Math.max(
      30_000,
      Number.parseInt(process.env.APIFY_TIMEOUT_MS ?? '120000', 10) || 120_000,
    ),
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

export async function fetchPreviewViaApify(
  config: ApifyPreviewConfig,
  username: string,
  fetchCount: number,
): Promise<ApifyPreviewProfile> {
  const safeCount = Math.min(50, Math.max(1, Math.floor(fetchCount)));
  const input = {
    usernames: [username],
    resultsLimit: safeCount,
  };

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

  if (res.status === 401 || res.status === 403) {
    throw new Error(`Apify returned HTTP ${res.status} (check APIFY_TOKEN).`);
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

  const profileRec = asRecord(body[0]);
  if (!profileRec) {
    throw new Error('Apify response had an unexpected profile shape.');
  }

  if (str(profileRec.error)) {
    throw new Error(`Apify reported: ${str(profileRec.error)}`);
  }

  const instagramUserId = str(profileRec.id) ?? str(profileRec.userId);
  const resolvedUsername = str(profileRec.username) ?? username;
  if (!instagramUserId) {
    throw new Error('Apify response missing a valid user id.');
  }

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
