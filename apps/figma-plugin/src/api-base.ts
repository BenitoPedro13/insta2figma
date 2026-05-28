/** API local (`pnpm dev`). Usar localhost — Figma só aceita isto em `devAllowedDomains`. */
export const LOCAL_API_BASE = 'http://localhost:3333';

/**
 * API em produção (Railway).
 * Tem de ser o domínio público exacto do serviço api (Settings → Networking).
 * Se estiver errado, o plugin mostra "Failed to fetch" ou HTTP 404.
 */
export const PRODUCTION_API_BASE =
  'https://insta2figma-production.up.railway.app';

/** `auto` = probe local /v1/health; `local` | `production` forçam o alvo no build. */
declare const __INSTA2FIGMA_API_MODE__: 'auto' | 'local' | 'production';

export function normApiBase(b: string): string {
  return String(b ?? '')
    .trim()
    .replace(/\/+$/, '');
}

let cachedBase: string | null = null;

const apiMode: 'auto' | 'local' | 'production' =
  typeof __INSTA2FIGMA_API_MODE__ !== 'undefined'
    ? __INSTA2FIGMA_API_MODE__
    : 'auto';

async function probeLocalApi(): Promise<boolean> {
  const local = normApiBase(LOCAL_API_BASE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const res = await fetch(`${local}/v1/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Escolhe a base da API: local se estiver a correr; senão produção.
 * Resultado fica em cache até `resetApiBaseCache()`.
 */
export async function resolveApiBase(): Promise<string> {
  if (cachedBase) return cachedBase;

  if (apiMode === 'local') {
    cachedBase = normApiBase(LOCAL_API_BASE);
    console.info('[Insta2Figma] API (forçada local):', cachedBase);
    return cachedBase;
  }

  if (apiMode === 'production') {
    cachedBase = normApiBase(PRODUCTION_API_BASE);
    console.info('[Insta2Figma] API (forçada produção):', cachedBase);
    return cachedBase;
  }

  if (await probeLocalApi()) {
    cachedBase = normApiBase(LOCAL_API_BASE);
    console.info('[Insta2Figma] API local detetada:', cachedBase);
    return cachedBase;
  }

  cachedBase = normApiBase(PRODUCTION_API_BASE);
  console.info('[Insta2Figma] API produção:', cachedBase);
  return cachedBase;
}

export function resetApiBaseCache(): void {
  cachedBase = null;
}
