import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
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

const uiHtmlRaw = readFileSync(uiHtml, 'utf8');

await esbuild.build({
  entryPoints: [join(pkgRoot, 'src', 'code.ts')],
  bundle: true,
  outfile: join(dist, 'code.js'),
  platform: 'browser',
  format: 'iife',
  target: ['es2017'],
  logLevel: 'info',
  define: {
    __html__: JSON.stringify(uiHtmlRaw),
  },
});

cpSync(join(pkgRoot, 'manifest.json'), join(dist, 'manifest.json'));

console.info('[FIGMA PLUGIN] Artefactos criados em', dist);
