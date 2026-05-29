// require() necessário porque o tsconfig usa moduleResolution "node" (CommonJS)
// e https-proxy-agent v7 usa package exports ESM-only
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HttpsProxyAgent } = require('https-proxy-agent') as {
  HttpsProxyAgent: new (url: string) => object;
};

let agent: object | undefined;
let initialized = false;

export function getProxyAgent(): object | undefined {
  if (initialized) return agent;
  initialized = true;

  const url = process.env.HTTP_PROXY_URL?.trim();
  if (!url) return undefined;

  agent = new HttpsProxyAgent(url);
  console.info(
    '[instagram-scraper] proxy configurado:',
    url.replace(/:\/\/[^@]+@/, '://***@'),
  );
  return agent;
}
