import type {
  InstagramPostSummaryItem,
  InstagramProfileSummary,
  ScrapeJobResultSummaryV5,
} from '@insta2figma/shared-contracts';
import { InstagramUpstreamError } from './instagram-upstream-error';

function asRecord(o: unknown): Record<string, unknown> | null {
  if (o !== null && typeof o === 'object' && !Array.isArray(o)) {
    return o as Record<string, unknown>;
  }
  return null;
}

function edgeCount(user: Record<string, unknown>, key: string): number {
  const edge = asRecord(user[key]);
  if (!edge) return 0;
  const c = edge.count;
  return typeof c === 'number' && Number.isFinite(c) ? c : 0;
}

function pickThumbnail(node: Record<string, unknown>): string | null {
  const d = node.display_url;
  if (typeof d === 'string' && d.length > 0) return d;
  const t = node.thumbnail_src;
  if (typeof t === 'string' && t.length > 0) return t;
  return null;
}

function isLikelyVideo(node: Record<string, unknown>): boolean {
  const tn = node.__typename;
  if (tn === 'GraphVideo') return true;
  const vu = node.video_url;
  return typeof vu === 'string' && vu.length > 0;
}

function parseTimelineSample(
  user: Record<string, unknown>,
  maxPosts: number,
): InstagramPostSummaryItem[] {
  const cap = Math.min(50, Math.max(0, maxPosts));
  const timeline = asRecord(user.edge_owner_to_timeline_media);
  if (!timeline) return [];

  const edges = timeline.edges;
  if (!Array.isArray(edges)) return [];

  const out: InstagramPostSummaryItem[] = [];
  for (const e of edges) {
    const er = asRecord(e);
    const node = er ? asRecord(er.node) : null;
    if (!node) continue;
    const shortcode = node.shortcode;
    if (typeof shortcode !== 'string' || shortcode.length === 0) continue;
    out.push({
      shortcode,
      thumbnailUrl: pickThumbnail(node),
      isVideo: isLikelyVideo(node),
    });
    if (out.length >= cap) break;
  }
  return out;
}

function buildProfileSummary(
  user: Record<string, unknown>,
): InstagramProfileSummary {
  const id = user.id;
  const username = user.username;
  if (typeof id !== 'string' || id.length === 0) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Resposta Instagram sem id de utilizador válido.',
      false,
    );
  }
  if (typeof username !== 'string' || username.length === 0) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Resposta Instagram sem username válido.',
      false,
    );
  }

  const fullName =
    typeof user.full_name === 'string' ? user.full_name : null;
  const bio = typeof user.biography === 'string' ? user.biography : null;
  const pic =
    typeof user.profile_pic_url_hd === 'string'
      ? user.profile_pic_url_hd
      : typeof user.profile_pic_url === 'string'
        ? user.profile_pic_url
        : null;

  return {
    id,
    username,
    fullName,
    biography: bio,
    followerCount: edgeCount(user, 'edge_followed_by'),
    followingCount: edgeCount(user, 'edge_follow'),
    mediaCount: edgeCount(user, 'edge_owner_to_timeline_media'),
    isPrivate: user.is_private === true,
    isVerified: user.is_verified === true,
    profilePicUrlHd: pic,
  };
}

/** Constrói o `result_summary` a partir do nó `data.user` de `web_profile_info`. */
export function buildScrapeSummaryV5FromUserNode(
  requestedUsernameNormalized: string,
  userNode: unknown,
  maxPosts: number,
): ScrapeJobResultSummaryV5 {
  const user = asRecord(userNode);
  if (!user) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Payload de utilizador vazio.',
      false,
    );
  }

  const profile = buildProfileSummary(user);
  const postsSample = parseTimelineSample(user, maxPosts);

  return {
    phase: 5,
    source: 'instagram_web_profile_info',
    username: requestedUsernameNormalized,
    profile,
    postsSample,
  };
}
