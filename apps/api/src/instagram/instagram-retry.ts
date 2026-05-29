const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 12_000;
const MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([429, 503]);

function sleepWithJitter(attempt: number): Promise<void> {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = Math.random() * 1_000;
  return new Promise((resolve) => setTimeout(resolve, exp + jitter));
}

// Node.js fetch (undici) aceita `dispatcher` como extensão mas o tipo RequestInit
// do TypeScript não o declara. Usamos um cast para passar o proxy agent.
type FetchFn = (url: string, init: RequestInit & { dispatcher?: object }) => Promise<Response>;
const nodeFetch = fetch as FetchFn;

export interface FetchResult {
  res: Response;
  retryCount: number;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { dispatcher?: object },
  label: string,
): Promise<FetchResult> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const waitSec = Math.round((BASE_DELAY_MS * 2 ** (attempt - 1)) / 1_000);
      console.warn(
        `[instagram-scraper] ${label} retry ${attempt}/${MAX_ATTEMPTS - 1} após ${waitSec}s`,
      );
      await sleepWithJitter(attempt - 1);
    }

    let res: Response;
    try {
      res = await nodeFetch(url, init);
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
