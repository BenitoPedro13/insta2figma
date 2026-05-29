/** Path segments that are not profile usernames on instagram.com. */
const RESERVED_PATH_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'ar',
  'popular',
  'locations',
  'nametag',
  'directory',
  'about-us',
  'legal',
  'privacy',
]);

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export type ParseInstagramUsernameKind = 'profile' | 'unsupported_url' | 'empty';

export type ParseInstagramUsernameResult = {
  username: string;
  kind: ParseInstagramUsernameKind;
};

function sanitizeUsernameSegment(segment: string): string {
  let decoded = segment.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    decoded = segment.trim();
  }
  const cleaned = decoded
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');
  if (!cleaned || cleaned.length > 30 || !USERNAME_PATTERN.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function normalizeUrlLike(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//iu.test(s)) {
    s = s.replace(/^\/+/, '');
    s = `https://${s}`;
  }
  return s;
}

function usernameFromInstagramUrl(urlString: string): ParseInstagramUsernameResult {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^www\./iu, '').toLowerCase();
    if (host !== 'instagram.com' && host !== 'instagr.am') {
      return { username: '', kind: 'empty' };
    }

    const parts = url.pathname.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) {
      return { username: '', kind: 'empty' };
    }

    const first = parts[0]!.toLowerCase();
    if (first === 'stories' && parts[1]) {
      const username = sanitizeUsernameSegment(parts[1]!);
      return username
        ? { username, kind: 'profile' }
        : { username: '', kind: 'empty' };
    }

    if (RESERVED_PATH_SEGMENTS.has(first)) {
      return { username: '', kind: 'unsupported_url' };
    }

    const username = sanitizeUsernameSegment(first);
    return username
      ? { username, kind: 'profile' }
      : { username: '', kind: 'empty' };
  } catch {
    return { username: '', kind: 'empty' };
  }
}

function looksLikeInstagramHost(text: string): boolean {
  return /(?:^|\/\/|\.)(?:www\.)?instagram\.com\b/iu.test(text) || /\binstagr\.am\b/iu.test(text);
}

/**
 * Extracts an Instagram profile username from free-form input:
 * `figma`, `@figma`, profile URLs, tracking query params (`?igsh=…`), etc.
 */
export function parseInstagramUsernameDetailed(
  raw: string,
): ParseInstagramUsernameResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { username: '', kind: 'empty' };
  }

  if (looksLikeInstagramHost(trimmed)) {
    const fromUrl = usernameFromInstagramUrl(normalizeUrlLike(trimmed));
    if (fromUrl.kind !== 'empty') {
      return fromUrl;
    }
  }

  const withoutQuery = trimmed.split(/[?#]/)[0]!.trim();
  if (withoutQuery !== trimmed && looksLikeInstagramHost(withoutQuery)) {
    const fromUrl = usernameFromInstagramUrl(normalizeUrlLike(withoutQuery));
    if (fromUrl.kind !== 'empty') {
      return fromUrl;
    }
  }

  let plain = trimmed.replace(/^@+/, '').split(/[?#]/)[0]!.trim();
  plain = plain.replace(/\/+$/, '');

  if (looksLikeInstagramHost(plain)) {
    const fromUrl = usernameFromInstagramUrl(normalizeUrlLike(plain));
    if (fromUrl.kind !== 'empty') {
      return fromUrl;
    }
  }

  if (plain.includes('/')) {
    const segments = plain.split('/').filter((s) => s.length > 0);
    const last = segments[segments.length - 1] ?? '';
    const username = sanitizeUsernameSegment(last);
    return username
      ? { username, kind: 'profile' }
      : { username: '', kind: 'empty' };
  }

  const username = sanitizeUsernameSegment(plain);
  return username
    ? { username, kind: 'profile' }
    : { username: '', kind: 'empty' };
}

/** @see parseInstagramUsernameDetailed */
export function parseInstagramUsername(raw: string): string {
  return parseInstagramUsernameDetailed(raw).username;
}
