/**
 * Smoke test manual contra o Instagram real (sem Redis/Postgres/BullMQ).
 *
 * Usage:
 *   pnpm --filter @insta2figma/worker exec tsx scripts/instagram-scrape-smoke.ts [username]
 *
 * Ou na raíz: pnpm ig:smoke [-- username]
 */

import 'dotenv/config';

import { HttpInstagramDataSource } from '../src/instagram/http-instagram-data-source';

async function main(): Promise<void> {
  const arg = process.argv[2]?.trim();
  const raw =
    arg && arg !== '--'
      ? arg
      : (process.env.IG_SMOKE_USERNAME ?? 'instagram');

  const username = raw.startsWith('@') ? raw.slice(1) : raw;
  if (!username) {
    console.error('Fornece um username ou defina IG_SMOKE_USERNAME.');
    process.exit(2);
  }

  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.IG_FETCH_TIMEOUT_MS ?? '30000', 10) || 30_000,
  );

  const ds = new HttpInstagramDataSource({ timeoutMs });

  console.error(
    `[ig:smoke] web_profile_info · username="${username}" · timeoutMs=${timeoutMs}`,
  );

  const summary = await ds.fetchProfilePostsSample(
    username.trim().toLowerCase(),
    3,
  );

  console.error(
    `[ig:smoke] OK · followers=${summary.profile.followerCount} · postsSample=${summary.postsSample.length}`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('[ig:smoke] FALHOU:', e instanceof Error ? e.message : e);
  process.exit(1);
});
