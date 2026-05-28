/**
 * fetch com logs no console do plugin (Plugins → Development → Open console).
 */

function redactUrl(url: string): string {
  return url.replace(/(authorization=)[^&]+/gi, '$1***');
}

export function formatFetchError(err: unknown, url: string, base?: string): string {
  const raw =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : 'Erro de rede desconhecido';

  const target = base ?? url;

  if (
    raw === 'Failed to fetch' ||
    /failed to fetch/i.test(raw) ||
    /network request failed/i.test(raw)
  ) {
    return [
      `Sem ligação à API (${target}).`,
      'Causas comuns: URL Railway errada em api-base.ts, API offline, ou domínio em falta no manifest.json.',
      `Pedido: ${redactUrl(url)}`,
      'Abre Plugins → Development → Open console e procura [Insta2Figma].',
    ].join(' ');
  }

  if (/abort/i.test(raw)) {
    return `Pedido cancelado ou timeout (${redactUrl(url)}).`;
  }

  return raw;
}

export async function apiFetch(
  url: string,
  init?: RequestInit,
  label = 'API',
): Promise<Response> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      console.warn(
        `[Insta2Figma] ${label} HTTP ${res.status}`,
        redactUrl(url),
      );
    }
    return res;
  } catch (err) {
    const base = /^https?:\/\/[^/]+/.exec(url)?.[0];
    const message = formatFetchError(err, url, base);
    console.error(`[Insta2Figma] ${label} falhou:`, message, err);
    throw new Error(message);
  }
}

export async function probeApiHealth(base: string): Promise<void> {
  const url = `${base.replace(/\/+$/, '')}/v1/health`;
  const res = await apiFetch(url, undefined, 'health');
  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }
  if (!res.ok) {
    throw new Error(
      `API respondeu ${res.status} em ${base}. Corpo: ${body.slice(0, 200)}`,
    );
  }
  console.info('[Insta2Figma] health OK', base, body.slice(0, 120));
}
