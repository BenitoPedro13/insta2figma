import type { Job, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  createJobBodySchema,
  type ScrapeJobResultSummaryV5,
} from '@insta2figma/shared-contracts';
import { uploadScrapeAssets } from '../storage/upload-scrape-assets';
import { InstagramUpstreamError } from './instagram-upstream-error';
import { InstagramDataSource } from './http-instagram-data-source';

/** Normalização mínima (API já valida formato). */
export function normalizeInstagramUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase();
}

function truncateMessage(msg: string, max = 2000): string {
  return msg.length <= max ? msg : `${msg.slice(0, max - 1)}…`;
}

async function markFailed(
  prisma: PrismaClient,
  jobId: string,
  code: string,
  message: string,
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: truncateMessage(message),
    },
  });
}

async function markSucceeded(
  prisma: PrismaClient,
  jobId: string,
  resultSummary: Prisma.InputJsonValue,
  resultStoragePrefix: string | null,
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'succeeded',
      finishedAt: new Date(),
      resultSummary,
      ...(resultStoragePrefix !== null
        ? { resultStoragePrefix }
        : {}),
    },
  });
}

/** Executa scrape real (job em `running`; retries BullMQ esperam mesmo estado). */
export async function processInstagramScrapeJob(
  prisma: PrismaClient,
  row: Job,
  source: InstagramDataSource,
): Promise<void> {
  const validated = createJobBodySchema.safeParse({
    type: row.type,
    input: row.input,
  });

  if (!validated.success) {
    await markFailed(
      prisma,
      row.id,
      'IG_PARSE',
      'Input do job inválido ou corrompido na BD.',
    );
    return;
  }

  const body = validated.data;
  const usernameNorm = normalizeInstagramUsername(body.input.username);

  let maxPosts: number =
    typeof body.input.maxPosts === 'number'
      ? body.input.maxPosts
      : body.type === 'SCRAPE_PROFILE'
        ? 8
        : 24;
  maxPosts = Math.min(50, Math.max(1, maxPosts));

  try {
    const summary = (await source.fetchProfilePostsSample(
      usernameNorm,
      maxPosts,
    )) as ScrapeJobResultSummaryV5;

    const prefix = await uploadScrapeAssets({
      prisma,
      jobId: row.id,
      summary,
      expandCarouselImages: body.input.expandCarouselImages === true,
    });

    await markSucceeded(
      prisma,
      row.id,
      summary as unknown as Prisma.InputJsonValue,
      prefix,
    );
  } catch (e) {
    if (e instanceof InstagramUpstreamError) {
      if (e.retryable) throw e;
      await markFailed(prisma, row.id, e.code, e.message);
      return;
    }
    console.error('[worker-scrape] erro inesperado', row.id, e);
    await markFailed(
      prisma,
      row.id,
      'INTERNAL',
      truncateMessage(e instanceof Error ? e.message : 'Erro interno.'),
    );
  }
}
