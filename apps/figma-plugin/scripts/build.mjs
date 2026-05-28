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

// __html__ is provided at runtime by Figma from manifest "ui": "ui.html".
await esbuild.build({
  entryPoints: [join(pkgRoot, 'src', 'code.ts')],
  bundle: true,
  outfile: join(dist, 'code.js'),
  platform: 'browser',
  format: 'iife',
  target: ['es2017'],
  logLevel: 'info',
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
