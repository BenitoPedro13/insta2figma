import type {
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { resolveScrapeSelection } from '@insta2figma/shared-contracts';
import { globalSessionPool, getProxyAgent, buildProxyAgent, fetchWithRetry, parseFeedItems, buildIgHeaders } from '@insta2figma/shared-instagram';
import { InstagramUpstreamError } from './instagram-upstream-error';
import { buildScrapeSummaryV5FromUserNode } from './parse-web-profile';

export interface InstagramDataSource {
  fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5>;
}

function webProfileUrl(username: string): string {
  const u = encodeURIComponent(username);
  return `https://i.instagram.com/api/v1/users/web_profile_info/?username=${u}`;
}

function feedUrl(userId: string, maxId?: string): string {
  const qs = new URLSearchParams({ count: '12' });
  if (maxId) qs.set('max_id', maxId);
  return `https://i.instagram.com/api/v1/feed/user/${encodeURIComponent(userId)}/?${qs.toString()}`;
}

function classifyFailMessage(
  msg: string,
): { code: 'IG_NOT_FOUND' | 'IG_RATE_LIMIT' | 'IG_BLOCKED'; retryable: boolean } | null {
  const m = msg.toLowerCase();
  if (m.includes('user not found') || m.includes('not found')) {
    return { code: 'IG_NOT_FOUND', retryable: false };
  }
  if (m.includes('wait') || m.includes('rate') || m.includes('limit')) {
    return { code: 'IG_RATE_LIMIT', retryable: true };
  }
  if (
    m.includes('checkpoint') ||
    m.includes('login') ||
    m.includes('unauthorized') ||
    m.includes('forbidden')
  ) {
    return { code: 'IG_BLOCKED', retryable: false };
  }
  return null;
}

const sessionPool = globalSessionPool;

/** Fonte Instagram com proxy, sessão e retry. */
export class HttpInstagramDataSource implements InstagramDataSource {
  constructor(
    private readonly options: { timeoutMs: number } = { timeoutMs: 30_000 },
  ) {}

  async fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    const session = sessionPool.next();
    const agent = session?.proxy ? buildProxyAgent(session.proxy) ?? getProxyAgent() : getProxyAgent();

    let res: Response;
    try {
      ({ res } = await fetchWithRetry(
        webProfileUrl(usernameNormalized),
        {
          method: 'GET',
          headers: buildIgHeaders(session?.cookie),
          signal: AbortSignal.timeout(this.options.timeoutMs),
          redirect: 'follow',
          ...(agent ? { dispatcher: agent } : {}),
        },
        'worker:profile',
      ));
    } catch (e) {
      throw new InstagramUpstreamError(
        'IG_UPSTREAM',
        'Network failure or timeout while contacting Instagram.',
        true,
        { cause: e },
      );
    }

    if (res.status === 429) {
      throw new InstagramUpstreamError('IG_RATE_LIMIT', 'Instagram returned rate limit (429).', true);
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      if (res.status === 400 || res.status === 401) sessionPool.markInvalid(session?.account ?? '');
      throw new InstagramUpstreamError('IG_BLOCKED', `Instagram returned HTTP ${res.status} (access denied).`, false);
    }
    if (res.status >= 500) {
      throw new InstagramUpstreamError('IG_UPSTREAM', `Instagram returned HTTP error ${res.status}.`, true);
    }

    const rawText = await res.text();
    const trimmed = rawText.trim();

    let body: unknown;
    try {
      body = JSON.parse(trimmed);
    } catch (e) {
      const preview = trimmed.replace(/\s+/gu, ' ').slice(0, 160);
      throw new InstagramUpstreamError(
        'IG_BLOCKED',
        `Non-JSON response (block, captcha, or HTML). Preview: ${preview}`,
        false,
        { cause: e },
      );
    }

    if (!body || typeof body !== 'object') {
      throw new InstagramUpstreamError('IG_PARSE', 'Unexpected response body.', false);
    }

    const envelope = body as Record<string, unknown>;

    if (envelope.status === 'fail') {
      const rawMsg = typeof envelope.message === 'string' ? envelope.message : 'Instagram status fail.';
      const classified = classifyFailMessage(rawMsg);
      if (classified) throw new InstagramUpstreamError(classified.code, rawMsg, classified.retryable);
      if (rawMsg.toLowerCase().includes('sorry')) throw new InstagramUpstreamError('IG_BLOCKED', rawMsg, false);
      throw new InstagramUpstreamError('IG_UPSTREAM', rawMsg, res.status >= 400);
    }

    const data = envelope.data as Record<string, unknown> | undefined;
    if (!data) throw new InstagramUpstreamError('IG_NOT_FOUND', 'User not found or response had no data.', false);

    const userNode = data.user as Record<string, unknown> | undefined;
    if (!userNode) throw new InstagramUpstreamError('IG_NOT_FOUND', 'User not found.', false);

    const userId = typeof userNode.id === 'string' ? userNode.id : String(userNode.id ?? '');
    const edge = userNode.edge_owner_to_timeline_media as Record<string, unknown> | undefined;
    const allEdges: unknown[] = Array.isArray(edge?.edges) ? [...edge.edges] : [];

    const selection = resolveScrapeSelection(selectionInput, defaults);
    const fetchCount = selection.fetchCount;

    // Pagina o feed endpoint para completar edges quando o web profile não tem posts suficientes
    if (userId && allEdges.length < fetchCount) {
      const pageInfo = edge?.page_info as { has_next_page?: boolean; end_cursor?: string } | undefined;
      let hasNext = allEdges.length === 0 ? true : pageInfo?.has_next_page === true;
      let maxId = allEdges.length === 0 ? undefined : (typeof pageInfo?.end_cursor === 'string' ? pageInfo.end_cursor : undefined);

      while (allEdges.length < fetchCount && hasNext) {
        try {
          const { res: feedRes } = await fetchWithRetry(
            feedUrl(userId, maxId),
            {
              method: 'GET',
              headers: buildIgHeaders(session?.cookie),
              signal: AbortSignal.timeout(this.options.timeoutMs),
              redirect: 'follow',
              ...(agent ? { dispatcher: agent } : {}),
            },
            'worker:feed-page',
          );
          if (!feedRes.ok) break;
          const feedBody = (await feedRes.json()) as Record<string, unknown>;
          const parsed = parseFeedItems(feedBody.items);
          console.info(`[worker:feed-page] userId=${userId} maxId=${maxId ?? 'none'} → ${parsed.length} posts`);
          if (parsed.length === 0) break;
          const mappedEdges = parsed.map((p) => ({
            node: {
              shortcode: p.shortcode,
              display_url: p.thumbnailUrl,
              __typename: p.isVideo ? 'GraphVideo' : 'GraphImage',
              ...(p.carouselImageUrls && p.carouselImageUrls.length > 0
                ? { edge_sidecar_to_children: { edges: p.carouselImageUrls.map((u) => ({ node: { display_url: u } })) } }
                : {}),
            },
          }));
          allEdges.push(...mappedEdges);
          hasNext = feedBody.more_available === true;
          maxId = typeof feedBody.next_max_id === 'string' ? feedBody.next_max_id : undefined;
          if (!maxId) break;
        } catch {
          break;
        }
      }
    }

    if (allEdges.length !== (Array.isArray(edge?.edges) ? edge.edges.length : 0)) {
      (userNode as Record<string, unknown>).edge_owner_to_timeline_media = {
        ...(edge ?? {}),
        edges: allEdges,
      };
    }

    try {
      return buildScrapeSummaryV5FromUserNode(
        usernameNormalized,
        userNode,
        selectionInput,
        defaults,
      );
    } catch (e) {
      if (e instanceof InstagramUpstreamError) throw e;
      throw new InstagramUpstreamError('IG_PARSE', 'Failed to parse profile data.', false, { cause: e });
    }
  }
}
