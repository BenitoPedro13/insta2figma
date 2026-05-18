/**
 * Chamada rede real ao Instagram. Desactivado por omissão.
 *
 * Corre com: RUN_IG_INTEGRATION=1 pnpm --filter @insta2figma/worker exec vitest run src/instagram/http-instagram.integration.test.ts
 * ou: pnpm test:integration (workspace)
 */

import { describe, expect, it } from 'vitest';

import { HttpInstagramDataSource } from './http-instagram-data-source';

const ENABLED = process.env.RUN_IG_INTEGRATION === '1';
const TARGET =
  process.env.IG_SMOKE_USERNAME?.trim()?.replace(/^@+/, '').toLowerCase() ||
  'instagram';

describe.skipIf(!ENABLED)(
  'HttpInstagramDataSource (RUN_IG_INTEGRATION=1)',
  () => {
    it(
      `obtém dados públicos de @${TARGET}`,
      async () => {
        const timeoutMs = Math.max(
          10_000,
          Number.parseInt(process.env.IG_FETCH_TIMEOUT_MS ?? '45000', 10) ||
            45_000,
        );
        const ds = new HttpInstagramDataSource({ timeoutMs });
        const summary = await ds.fetchProfilePostsSample(TARGET, { maxPosts: 2 });

        console.log('summary', summary);

        expect(summary.phase).toBe(5);
        expect(summary.source).toBe('instagram_web_profile_info');
        expect(summary.profile.username.length).toBeGreaterThan(0);
        expect(typeof summary.profile.followerCount).toBe('number');
        expect(Array.isArray(summary.postsSample)).toBe(true);
      },
      120_000,
    );
  },
);
