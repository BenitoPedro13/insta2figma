#!/usr/bin/env node
/**
 * Converte um export do Cookie-Editor para o formato IG_SESSION_POOL.
 *
 * Como usar:
 *  1. Instala a extensão Cookie-Editor (Chrome/Firefox)
 *  2. Vai a instagram.com com sessão activa
 *  3. Abre Cookie-Editor → Export → Export as JSON → guarda em cookies.json
 *  4. Corre: node scripts/ig-cookie-helper.mjs cookies.json bot1 [http://proxy:porta]
 *
 * O output é o JSON a copiar para IG_SESSION_POOL no Railway.
 */

import { readFileSync } from 'node:fs';

const [, , filePath, account = 'bot1', proxy] = process.argv;

if (!filePath) {
  console.error('Uso: node scripts/ig-cookie-helper.mjs <cookies.json> [account] [proxy]');
  console.error('  cookies.json  — export do Cookie-Editor (instagram.com)');
  console.error('  account       — nome para logs (ex: bot1). Default: bot1');
  console.error('  proxy         — opcional, ex: http://user:pass@host:3128');
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(filePath, 'utf8');
} catch {
  console.error(`Não consegui ler o ficheiro: ${filePath}`);
  process.exit(1);
}

let cookies;
try {
  cookies = JSON.parse(raw);
} catch {
  console.error('Ficheiro não é JSON válido. Exporta do Cookie-Editor → Export as JSON.');
  process.exit(1);
}

if (!Array.isArray(cookies)) {
  console.error('Formato inesperado. O Cookie-Editor exporta um array de objectos.');
  process.exit(1);
}

// Filtra cookies do instagram.com e formata como header Cookie
const cookieStr = cookies
  .filter((c) => typeof c.domain === 'string' && c.domain.includes('instagram.com'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');

if (!cookieStr) {
  console.error('Nenhum cookie do instagram.com encontrado. Confirma que exportaste de instagram.com.');
  process.exit(1);
}

const entry = {
  account,
  cookie: cookieStr,
  ...(proxy ? { proxy } : {}),
};

// Lê pool existente se houver IG_SESSION_POOL no env (para append)
let existing = [];
const envPool = process.env.IG_SESSION_POOL?.trim();
if (envPool) {
  try {
    const parsed = JSON.parse(envPool);
    if (Array.isArray(parsed)) {
      // Remove entrada com o mesmo account se já existir
      existing = parsed.filter((e) => e.account !== account);
    }
  } catch { /* ignora */ }
}

const pool = [...existing, entry];

console.log('\n✅ Cookie extraído com sucesso!\n');
console.log('━━━ Para Railway (copia este valor para IG_SESSION_POOL) ━━━\n');
console.log(JSON.stringify(pool));
console.log('\n━━━ Formatado para leitura ━━━\n');
console.log(JSON.stringify(pool, null, 2));
console.log('\n━━━ Via admin endpoint (sem redeploy) ━━━\n');
console.log(
  `curl -X POST https://<api>.up.railway.app/admin/sessions \\
  -H "x-admin-key: <ADMIN_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ sessions: pool })}'`,
);
