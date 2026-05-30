const RETRYABLE_STATUSES = new Set([429, 503]);

// O fetch global do Node.js ignora o `dispatcher`. Usamos o fetch do undici
// directamente, que suporta ProxyAgent.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetch: undiciFetch } = require('undici') as {
  fetch: (url: string, init: RequestInit & { dispatcher?: object }) => Promise<Response>;
};

export interface RetryOptions {
  /** Delay base em ms (dobra a cada tentativa). Default: 2000 */
  baseDelayMs?: number;
  /** Delay máximo em ms. Default: 12000 */
  maxDelayMs?: number;
  /** Nº máximo de tentativas. Default: 3 */
  maxAttempts?: number;
}

/** Preset único: 500ms → 1s. O BullMQ tem o seu próprio backoff de minutos para rate limits reais. */
export const WORKER_RETRY: RetryOptions = { baseDelayMs: 500, maxDelayMs: 3_000, maxAttempts: 3 };

/** Alias — mesmo preset, mantido para clareza no código da API. */
export const PREVIEW_RETRY: RetryOptions = WORKER_RETRY;

function sleepWithJitter(baseMs: number, maxMs: number, attempt: number): Promise<void> {
  const exp = Math.min(baseMs * 2 ** attempt, maxMs);
  const jitter = Math.random() * 500;
  return new Promise((resolve) => setTimeout(resolve, exp + jitter));
}

export interface FetchResult {
  res: Response;
  retryCount: number;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { dispatcher?: object },
  label: string,
  opts: RetryOptions = WORKER_RETRY,
): Promise<FetchResult> {
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 12_000;
  const maxAttempts = opts.maxAttempts ?? 3;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      console.warn(
        `[instagram-scraper] ${label} retry ${attempt}/${maxAttempts - 1} após ${Math.round(waitMs / 1000)}s`,
      );
      await sleepWithJitter(baseDelayMs, maxDelayMs, attempt - 1);
    }

    let res: Response;
    try {
      res = await undiciFetch(url, init);
    } catch (err) {
      lastError = err;
      continue;
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      lastError = new Error(`HTTP ${res.status}`);
      continue;
    }

    return { res, retryCount: attempt };
  }

  throw lastError ?? new Error('Esgotadas as tentativas de fetch ao Instagram');
}
