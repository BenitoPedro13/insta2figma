import type {
  InstagramProfileSummary,
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import {
  parseTimelineSampleFromUserNode,
  resolveScrapeSelection,
  slicePostsBySelection,
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
  selectionInput: ScrapeSelectionInput,
  defaults?: { defaultMaxPosts?: number },
): ScrapeJobResultSummaryV5 {
  const user = asRecord(userNode);
  if (!user) {
    throw new InstagramUpstreamError(
      'IG_PARSE',
      'Payload de utilizador vazio.',
      false,
    );
  }

  const selection = resolveScrapeSelection(selectionInput, defaults);
  const profile = buildProfileSummary(user);
  const fetched = parseTimelineSampleFromUserNode(userNode, selection.fetchCount);
  const postsSample = slicePostsBySelection(fetched, selection);

  return {
    phase: 5,
    source: 'instagram_web_profile_info',
    username: requestedUsernameNormalized,
    profile,
    postsSample,
  };
}

/** @deprecated Use `parseTimelineSampleFromUserNode` via shared-contracts. */
export function parseTimelineSample(
  user: Record<string, unknown>,
  maxPosts: number,
) {
  return parseTimelineSampleFromUserNode(user, maxPosts);
}
