import * as esbuild from 'esbuild';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(scriptDir);
const dist = join(pkgRoot, 'dist');
mkdirSync(dist, { recursive: true });

const LOCAL_API_BASE =
  process.env.INSTA2FIGMA_LOCAL_API_BASE ?? 'http://localhost:3333';
const PRODUCTION_API_BASE =
  process.env.INSTA2FIGMA_PRODUCTION_API_BASE ??
  'https://insta2figma-production.up.railway.app';
const API_MODE = process.env.INSTA2FIGMA_API_MODE ?? 'auto';
if (!['auto', 'local', 'production'].includes(API_MODE)) {
  throw new Error(
    `INSTA2FIGMA_API_MODE inválido: ${API_MODE} (auto | local | production)`,
  );
}

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vite', 'build'],
  {
    cwd: pkgRoot,
    stdio: 'inherit',
    env: process.env,
  },
);

const indexHtml = join(dist, 'index.html');
const uiHtml = join(dist, 'ui.html');
if (existsSync(indexHtml)) {
  if (existsSync(uiHtml)) {
    unlinkSync(uiHtml);
  }
  renameSync(indexHtml, uiHtml);
} else {
  throw new Error('[FIGMA PLUGIN] Vite não gerou dist/index.html');
}

await esbuild.build({
  entryPoints: [join(pkgRoot, 'src', 'code.ts')],
  bundle: true,
  outfile: join(dist, 'code.js'),
  platform: 'browser',
  format: 'iife',
  target: ['es2017'],
  logLevel: 'info',
  define: {
    __INSTA2FIGMA_API_MODE__: JSON.stringify(API_MODE),
  },
});

const manifestSrc = JSON.parse(
  readFileSync(join(pkgRoot, 'manifest.json'), 'utf8'),
);

const distManifest = {
  ...manifestSrc,
  main: 'code.js',
  ui: 'ui.html',
};

writeFileSync(
  join(dist, 'manifest.json'),
  `${JSON.stringify(distManifest, null, 2)}\n`,
);

console.info('[FIGMA PLUGIN] Artefactos criados em', dist);
console.info('[FIGMA PLUGIN] API mode:', API_MODE);
console.info('[FIGMA PLUGIN] Local:', LOCAL_API_BASE);
console.info('[FIGMA PLUGIN] Produção:', PRODUCTION_API_BASE);
