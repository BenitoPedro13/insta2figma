import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(pkgRoot, 'ui-src');
const pluginUiSrc = resolve(pkgRoot, '../../packages/plugin-ui/src');

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    viteSingleFile({
      useRecommendedBuildConfig: true,
      deleteInlinedFiles: true,
    }),
  ],
  /** UI sources live under ui-src; build output goes to package dist/. */
  root: uiRoot,
  envDir: pkgRoot,
  base: './',
  resolve: {
    alias: {
      '@': pluginUiSrc,
      '@insta2figma/shared-contracts': resolve(
        pkgRoot,
        '../../packages/shared-contracts/src/index.ts',
      ),
      '@insta2figma/plugin-ui': resolve(
        pkgRoot,
        '../../packages/plugin-ui/src/index.ts',
      ),
    },
  },
  build: {
    outDir: resolve(pkgRoot, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(uiRoot, 'index.html'),
    },
  },
});
