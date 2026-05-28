/**
 * Generates ui-src/globals.css (AlignUI blue/gray/oklch, Tailwind v4 @theme).
 * Run: pnpm --filter @insta2figma/figma-plugin run alignui:globals
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import template from 'lodash.template';
import { GLOBALS_CSS } from './alignui-vendor/templates.ts';
import {
  animations,
  blockShadows,
  borderRadii,
  darkBlockShadows,
  primaryThemeConfig,
  rawHexColors,
  shadows,
  texts,
} from './alignui-vendor/tokens.ts';
import { formatOklchColor } from './alignui-vendor/color-helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const outPath = path.join(pkgRoot, 'ui-src/globals.css');

const colorVariables = Object.fromEntries(
  Object.entries(rawHexColors).map(([colorName, shades]) => [
    colorName,
    Object.fromEntries(
      Object.entries(shades).map(([shade, hex]) => [
        shade,
        formatOklchColor(hex),
      ]),
    ),
  ]),
);

const themeConfig = primaryThemeConfig.blue;

const css = template(GLOBALS_CSS)({
  config: { tailwind: { prefix: '' } },
  primaryColor: 'blue',
  neutralColor: 'gray',
  primaryBaseShade: themeConfig.baseShade,
  primaryBaseDarkShade: themeConfig.baseDarkShade,
  ...colorVariables,
  texts: JSON.stringify(texts, null, 2),
  shadows: JSON.stringify(shadows, null, 2),
  blockShadows: JSON.stringify(blockShadows, null, 2),
  darkBlockShadows: JSON.stringify(darkBlockShadows, null, 2),
  borderRadii: JSON.stringify(borderRadii, null, 2),
  animations: JSON.stringify(animations, null, 2),
});

fs.writeFileSync(outPath, css, 'utf8');
console.log(`[alignui] wrote ${outPath} (${css.split('\n').length} lines)`);
