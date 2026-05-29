// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ProxyAgent } = require('undici') as { ProxyAgent: new (url: string) => object };

function redact(url: string): string {
  return url.replace(/:\/\/[^@]+@/, '://***@');
}

function buildAgent(url: string): object | null {
  try {
    return new ProxyAgent(url);
  } catch {
    console.error('[instagram-scraper] proxy inválido ignorado:', redact(url));
    return null;
  }
}

function loadProxyPool(): object[] {
  const poolRaw = process.env.IG_PROXY_POOL?.trim();
  if (poolRaw) {
    try {
      const urls = JSON.parse(poolRaw) as unknown;
      if (Array.isArray(urls) && urls.length > 0) {
        const agents = (urls as string[]).map(buildAgent).filter(Boolean) as object[];
        if (agents.length > 0) {
          console.info(`[instagram-scraper] ${agents.length} proxies configurados`);
          return agents;
        }
      }
    } catch {
      console.error('[instagram-scraper] IG_PROXY_POOL inválido — ignorado');
    }
  }

  const single = process.env.HTTP_PROXY_URL?.trim();
  if (single) {
    const agent = buildAgent(single);
    if (agent) {
      console.info('[instagram-scraper] proxy configurado:', redact(single));
      return [agent];
    }
  }

  console.warn('[instagram-scraper] Nenhum proxy configurado — pedidos saem do IP Railway');
  return [];
}

const pool: object[] = loadProxyPool();
let poolIndex = 0;

export function getProxyAgent(): object | undefined {
  if (pool.length === 0) return undefined;
  const agent = pool[poolIndex % pool.length];
  poolIndex = (poolIndex + 1) % pool.length;
  return agent;
}
