import 'dotenv/config';
import type { Job as BullMqJob } from 'bullmq';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

import {
  SCRAPE_INSTAGRAM_V1_QUEUE,
  MEDIA_BACKFILL_V1_QUEUE,
  scrapeInstagramV1JobPayloadSchema,
} from '@insta2figma/shared-contracts';
import { globalSessionPool, REDIS_SESSION_KEY } from '@insta2figma/shared-instagram';
import type { SessionEntry } from '@insta2figma/shared-instagram';

import { ApifyInstagramDataSource } from './instagram/apify-instagram-data-source';
import { FallbackInstagramDataSource } from './instagram/fallback-instagram-data-source';
import {
  HttpInstagramDataSource,
  type InstagramDataSource,
} from './instagram/http-instagram-data-source';
import { InstagramUpstreamError } from './instagram/instagram-upstream-error';
import { processInstagramScrapeJob } from './instagram/scrape-runner';
import { processMediaBackfillJob } from './backfill/media-backfill.processor';

function truncateMessage(msg: string, max = 2000): string {
  return msg.length <= max ? msg : `${msg.slice(0, max - 1)}…`;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Polling de sessões: carrega do Redis ao arrancar e depois a cada 60s
  async function syncSessions(): Promise<void> {
    try {
      const raw = await connection.get(REDIS_SESSION_KEY);
      if (!raw) return;
      const sessions = JSON.parse(raw) as SessionEntry[];
      if (Array.isArray(sessions) && sessions.length > 0) globalSessionPool.reload(sessions);
    } catch { /* ignora — continua com env var */ }
  }
  void syncSessions();
  const sessionSyncTimer = setInterval(() => void syncSessions(), 60_000);

  const timeoutMs = Math.max(
    5_000,
    Number.parseInt(process.env.IG_FETCH_TIMEOUT_MS ?? '30000', 10) ||
      30_000,
  );
  const httpSource = new HttpInstagramDataSource({ timeoutMs });

  // Fallback Apify (profile-scraper) — só ativo se houver token configurado.
  const apifyToken = process.env.APIFY_TOKEN?.trim();
  let dataSource: InstagramDataSource = httpSource;
  if (apifyToken) {
    const apifyTimeoutMs = Math.max(
      30_000,
      Number.parseInt(process.env.APIFY_TIMEOUT_MS ?? '120000', 10) || 120_000,
    );
    const apifySource = new ApifyInstagramDataSource({
      token: apifyToken,
      actorId:
        process.env.APIFY_IG_POST_ACTOR?.trim() ||
        process.env.APIFY_IG_PROFILE_ACTOR?.trim() ||
        'apify~instagram-profile-scraper',
      timeoutMs: apifyTimeoutMs,
    });
    dataSource = new FallbackInstagramDataSource(
      { name: 'http-direct', source: httpSource },
      [{ name: 'apify-profile-scraper', source: apifySource }],
    );
    console.info('[worker] fallback Apify ativo (instagram-profile-scraper).');
  } else {
    console.info('[worker] APIFY_TOKEN ausente — sem fallback Apify.');
  }

  const concurrency = Math.max(
    1,
    Number.parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10) || 2,
  );

  const worker = new Worker(
    SCRAPE_INSTAGRAM_V1_QUEUE,
    async (bullJob) => {
      const parsed = scrapeInstagramV1JobPayloadSchema.safeParse(bullJob.data);
      if (!parsed.success) {
        console.error(
          '[worker] payload inválido',
          bullJob.id,
          parsed.error.flatten(),
        );
        return;
      }

      const jobId = parsed.data.jobId;
      const row = await prisma.job.findUnique({ where: { id: jobId } });
      if (!row) {
        console.warn('[worker] job inexistente na BD, ack:', jobId);
        return;
      }

      const terminalSkip =
        row.status === 'succeeded' ||
        row.status === 'failed' ||
        row.status === 'canceled';

      if (terminalSkip) {
        console.info(
          '[worker] idempotente — já terminal',
          jobId,
          row.status,
        );
        return;
      }

      if (row.status === 'queued') {
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'running', startedAt: new Date() },
        });
      }

      await processInstagramScrapeJob(prisma, row, dataSource);
      console.info(`[worker] job ${jobId} ciclo BullMQ terminou sem throw.`);
    },
    { connection, concurrency },
  );

  worker.on('failed', async (job: BullMqJob | undefined, err: Error) => {
    const finalFailure = Boolean(job?.finishedOn);
    if (!finalFailure) {
      console.warn(
        '[worker] tentativa falhou; retry agendado',
        job?.id,
        err?.message,
      );
      return;
    }

    const parsed = scrapeInstagramV1JobPayloadSchema.safeParse(job?.data);
    if (!parsed.success) return;
    const bizId = parsed.data.jobId;

    const current = await prisma.job.findUnique({ where: { id: bizId } });
    if (!current || current.status !== 'running') return;

    let code = 'INTERNAL';
    let message = truncateMessage(
      err?.message ?? 'Todas as tentativas na fila falharam.',
    );

    if (err instanceof InstagramUpstreamError) {
      code = err.code;
      message = truncateMessage(err.message);
    }

    await prisma.job.update({
      where: { id: bizId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: code,
        errorMessage: message,
      },
    });
    console.warn(
      `[worker] job ${bizId} falhou permanentemente (${code}) após retries.`,
    );
  });

  // 2º Worker: backfill assíncrono de imagens (fila `media-backfill-v1`, §6.6).
  const backfillConcurrency = Math.max(
    1,
    Number.parseInt(process.env.MEDIA_BACKFILL_CONCURRENCY ?? '4', 10) || 4,
  );
  const backfillWorker = new Worker(
    MEDIA_BACKFILL_V1_QUEUE,
    async (bullJob) => {
      await processMediaBackfillJob(prisma, bullJob.data);
    },
    { connection, concurrency: backfillConcurrency },
  );
  backfillWorker.on('failed', (job: BullMqJob | undefined, err: Error) => {
    if (!job?.finishedOn) return; // só loga a falha final (após retries)
    console.warn('[backfill] job falhou definitivamente', job?.id, err?.message);
  });

  console.info(
    `[worker] à escuta das filas "${SCRAPE_INSTAGRAM_V1_QUEUE}" (concurrency=${concurrency}, igTimeoutMs=${timeoutMs}) e "${MEDIA_BACKFILL_V1_QUEUE}" (concurrency=${backfillConcurrency})`,
  );

  const shutdown = async (): Promise<void> => {
    clearInterval(sessionSyncTimer);
    await worker.close();
    await backfillWorker.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[worker] crash', err);
  process.exit(1);
});
