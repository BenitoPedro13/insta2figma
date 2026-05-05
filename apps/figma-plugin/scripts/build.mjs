import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(scriptDir);
const dist = join(pkgRoot, 'dist');
mkdirSync(dist, { recursive: true });

const uiHtmlPath = join(pkgRoot, 'ui.html');
const uiHtmlRaw = readFileSync(uiHtmlPath, 'utf8');

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
cpSync(join(pkgRoot, 'ui.html'), join(dist, 'ui.html'));

console.info('[FIGMA PLUGIN] Artefactos criados em', dist);
