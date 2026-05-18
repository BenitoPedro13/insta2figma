import type {
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { InstagramUpstreamError } from './instagram-upstream-error';
import { buildScrapeSummaryV5FromUserNode } from './parse-web-profile';

export interface InstagramDataSource {
  fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5>;
}

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.instagram.com/',
  Origin: 'https://www.instagram.com',
};

function webProfileUrl(username: string): string {
  const u = encodeURIComponent(username);
  return `https://i.instagram.com/api/v1/users/web_profile_info/?username=${u}`;
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
    m.includes('login') ||
    m.includes('unauthorized') ||
    m.includes('forbidden')
  ) {
    return { code: 'IG_BLOCKED', retryable: false };
  }
  return null;
}

/** Fonte Instagram baseada em HTTP pública (`web_profile_info`), alinhada ao `crawler/main.py`. */
export class HttpInstagramDataSource implements InstagramDataSource {
  constructor(
    private readonly options: { timeoutMs: number } = { timeoutMs: 30_000 },
  ) {}

  async fetchProfilePostsSample(
    usernameNormalized: string,
    selectionInput: ScrapeSelectionInput,
    defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    let res: Response;
    try {
      res = await fetch(webProfileUrl(usernameNormalized), {
        method: 'GET',
        headers: IG_HEADERS,
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'follow',
      });
    } catch (e) {
      throw new InstagramUpstreamError(
        'IG_UPSTREAM',
        'Falha de rede ou timeout ao contactar Instagram.',
        true,
        { cause: e },
      );
    }

    if (res.status === 429) {
      throw new InstagramUpstreamError(
        'IG_RATE_LIMIT',
        'Instagram devolveu limite de pedidos (429).',
        true,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new InstagramUpstreamError(
        'IG_BLOCKED',
        `Instagram devolveu HTTP ${res.status} (acesso negado).`,
        false,
      );
    }
    if (res.status >= 500) {
      throw new InstagramUpstreamError(
        'IG_UPSTREAM',
        `Instagram devolveu erro HTTP ${res.status}.`,
        true,
      );
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
        `Resposta não-JSON (bloqueio, captcha ou HTML). Pré-visualização: ${preview}`,
        false,
        { cause: e },
      );
    }

    if (!body || typeof body !== 'object') {
      throw new InstagramUpstreamError(
        'IG_PARSE',
        'Corpo de resposta inesperado.',
        false,
      );
    }

    const envelope = body as Record<string, unknown>;

    if (envelope.status === 'fail') {
      const rawMsg =
        typeof envelope.message === 'string' ? envelope.message : 'Instagram status fail.';
      const classified = classifyFailMessage(rawMsg);
      if (classified) {
        throw new InstagramUpstreamError(classified.code, rawMsg, classified.retryable);
      }
      if (rawMsg.toLowerCase().includes('sorry')) {
        throw new InstagramUpstreamError('IG_BLOCKED', rawMsg, false);
      }
      throw new InstagramUpstreamError('IG_UPSTREAM', rawMsg, res.status >= 400);
    }

    const data = envelope.data;
    if (data === null || data === undefined) {
      throw new InstagramUpstreamError(
        'IG_NOT_FOUND',
        'Utilizador não encontrado ou resposta sem dados.',
        false,
      );
    }

    const dataRec = data as Record<string, unknown>;
    const userNode = dataRec.user;
    if (userNode === null || userNode === undefined) {
      throw new InstagramUpstreamError(
        'IG_NOT_FOUND',
        'Utilizador não encontrado.',
        false,
      );
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
      throw new InstagramUpstreamError(
        'IG_PARSE',
        'Falha ao interpretar dados do perfil.',
        false,
        { cause: e },
      );
    }
  }
}
