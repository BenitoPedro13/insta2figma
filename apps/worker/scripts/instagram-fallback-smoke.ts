/**
 * Simula falha da fonte primária (ex.: rate limit do Instagram) e testa o fallback Apify.
 *
 * Usage:
 *   pnpm --filter @insta2figma/worker exec tsx scripts/instagram-fallback-smoke.ts [username]
 *
 * Requer APIFY_TOKEN em apps/worker/.env
 */

import 'dotenv/config';

import { ApifyInstagramDataSource } from '../src/instagram/apify-instagram-data-source';
import { FallbackInstagramDataSource } from '../src/instagram/fallback-instagram-data-source';
import type { InstagramDataSource } from '../src/instagram/http-instagram-data-source';
import { InstagramUpstreamError } from '../src/instagram/instagram-upstream-error';
import type {
  ScrapeJobResultSummaryV5,
  ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';

class SimulatedRateLimitedSource implements InstagramDataSource {
  async fetchProfilePostsSample(
    _usernameNormalized: string,
    _selectionInput: ScrapeSelectionInput,
    _defaults?: { defaultMaxPosts?: number },
  ): Promise<ScrapeJobResultSummaryV5> {
    throw new InstagramUpstreamError(
      'IG_RATE_LIMIT',
      'Simulated Instagram rate limit (HTTP 429) — como no Railway em prod.',
      true,
    );
  }
}

async function main(): Promise<void> {
  const apifyToken = process.env.APIFY_TOKEN?.trim();
  if (!apifyToken) {
    console.error('[ig:fallback-smoke] APIFY_TOKEN ausente em apps/worker/.env');
    process.exit(2);
  }

  const arg = process.argv[2]?.trim();
  const raw =
    arg && arg !== '--'
      ? arg
      : (process.env.IG_SMOKE_USERNAME ?? 'figma');
  const username = (raw.startsWith('@') ? raw.slice(1) : raw).trim().toLowerCase();
  if (!username) {
    console.error('[ig:fallback-smoke] Fornece um username ou defina IG_SMOKE_USERNAME.');
    process.exit(2);
  }

  const apifyTimeoutMs = Math.max(
    30_000,
    Number.parseInt(process.env.APIFY_TIMEOUT_MS ?? '120000', 10) || 120_000,
  );

  const dataSource = new FallbackInstagramDataSource(
    { name: 'simulated-http-rate-limit', source: new SimulatedRateLimitedSource() },
    [
      {
        name: 'apify-profile-scraper',
        source: new ApifyInstagramDataSource({
          token: apifyToken,
          actorId:
            process.env.APIFY_IG_PROFILE_ACTOR?.trim() ||
            'apify~instagram-profile-scraper',
          timeoutMs: apifyTimeoutMs,
        }),
      },
    ],
  );

  console.error(
    `[ig:fallback-smoke] primária=simulated 429 · fallback=Apify · username="${username}" · timeoutMs=${apifyTimeoutMs}`,
  );
  console.error('[ig:fallback-smoke] a chamar Apify (pode levar 20–60s)...');

  const summary = await dataSource.fetchProfilePostsSample(username, {
    selectionMode: 'recent',
    postCount: 3,
  });

  console.error(
    `[ig:fallback-smoke] OK via fallback · followers=${summary.profile.followerCount} · postsSample=${summary.postsSample.length}`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('[ig:fallback-smoke] FALHOU:', e instanceof Error ? e.message : e);
  process.exit(1);
});
