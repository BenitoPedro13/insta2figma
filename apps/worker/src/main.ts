import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const { SCRAPE_INSTAGRAM_V1_QUEUE, scrapeInstagramV1JobPayloadSchema } =
    await import('@insta2figma/shared-contracts');

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
      if (row.status !== 'queued') {
        console.info(
          '[worker] idempotente — estado',
          jobId,
          row.status,
        );
        return;
      }

      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'running', startedAt: new Date() },
      });

      try {
        await new Promise((r) => setTimeout(r, 500));
        const input = row.input as { username?: string };
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'succeeded',
            finishedAt: new Date(),
            resultSummary: {
              simulated: true,
              phase: 4,
              username:
                typeof input.username === 'string' ? input.username : null,
            },
          },
        });
      } catch (err) {
        console.error('[worker] erro ao processar', jobId, err);
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorCode: 'INTERNAL',
            errorMessage: 'Erro no worker (simulação Fase 4).',
          },
        });
        throw err;
      }
    },
    { connection, concurrency },
  );

  worker.on('failed', (job, err) => {
    console.error('[worker] Bull job failed', job?.id, err);
  });

  console.info(
    `[worker] Insta2Figma à escuta da fila "${SCRAPE_INSTAGRAM_V1_QUEUE}" (concurrency=${concurrency})`,
  );

  const shutdown = async (): Promise<void> => {
    await worker.close();
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
