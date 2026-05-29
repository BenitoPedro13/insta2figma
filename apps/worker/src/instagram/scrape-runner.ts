import type { Job, PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  createJobBodySchema,
  parseInstagramUsername,
  resolveScrapeSelection,
  type ScrapeJobResultSummaryV5,
} from '@insta2figma/shared-contracts';
import { uploadScrapeAssets } from '../storage/upload-scrape-assets';
import { InstagramUpstreamError } from './instagram-upstream-error';
import { InstagramDataSource } from './http-instagram-data-source';
import {
  adjustUserImagesUsed,
  countBillableJobImages,
  readEstimatedImportImages,
} from '../plan/quota-usage';

/** Normalização mínima (API já valida formato). */
export function normalizeInstagramUsername(raw: string): string {
  return parseInstagramUsername(raw);
}

function truncateMessage(msg: string, max = 2000): string {
  return msg.length <= max ? msg : `${msg.slice(0, max - 1)}…`;
}

async function markFailed(
  prisma: PrismaClient,
  job: Job,
  code: string,
  message: string,
): Promise<void> {
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: truncateMessage(message),
    },
  });

  const reserved = readEstimatedImportImages(job.input);
  await adjustUserImagesUsed(prisma, job.userId, -reserved);
}

async function markSucceeded(
  prisma: PrismaClient,
  job: Job,
  resultSummary: Prisma.InputJsonValue,
  resultStoragePrefix: string | null,
): Promise<void> {
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: 'succeeded',
      finishedAt: new Date(),
      resultSummary,
      ...(resultStoragePrefix !== null
        ? { resultStoragePrefix }
        : {}),
    },
  });

  const reserved = readEstimatedImportImages(job.input);
  const actual = await countBillableJobImages(prisma, job.id);
  const billable = actual > 0 ? actual : reserved;
  await adjustUserImagesUsed(prisma, job.userId, billable - reserved);
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
      row,
      'IG_PARSE',
      'Invalid or corrupted job input in the database.',
    );
    return;
  }

  const body = validated.data;
  const usernameNorm = normalizeInstagramUsername(body.input.username);

  const defaultMaxPosts =
    typeof body.input.maxPosts === 'number'
      ? body.input.maxPosts
      : body.type === 'SCRAPE_PROFILE'
        ? 8
        : 24;

  const selection = resolveScrapeSelection(body.input, {
    defaultMaxPosts,
  });

  try {
    const summary = (await source.fetchProfilePostsSample(
      usernameNorm,
      body.input,
      { defaultMaxPosts },
    )) as ScrapeJobResultSummaryV5;

    const postsWithThumb = summary.postsSample.filter(p => !!p.thumbnailUrl).length;
    console.info(
      `[worker-scrape] ${row.id} @${usernameNorm} — ${summary.postsSample.length} posts, ${postsWithThumb} com thumbnail`,
      summary.postsSample.slice(0, 3).map(p => ({ shortcode: p.shortcode, thumb: p.thumbnailUrl?.slice(0, 60) ?? null })),
    );

    const expandCarousel = body.input.expandCarouselImages === true;
    const summaryWithMeta: ScrapeJobResultSummaryV5 = {
      ...summary,
      scrapingMeta: {
        requestedMaxPosts:
          selection.mode === 'recent'
            ? selection.postCount
            : selection.fetchCount,
        expandCarouselImages: expandCarousel,
        postsInSample: summary.postsSample.length,
        selectionMode: selection.mode,
        startIndex: selection.startIndex,
        postCount: selection.postCount,
        timelineOrder: selection.timelineOrder,
        fetchCount: selection.fetchCount,
      },
    };

    const prefix = await uploadScrapeAssets({
      prisma,
      jobId: row.id,
      summary: summaryWithMeta,
      expandCarouselImages: expandCarousel,
    });

    await markSucceeded(
      prisma,
      row,
      summaryWithMeta as unknown as Prisma.InputJsonValue,
      prefix,
    );
  } catch (e) {
    if (e instanceof InstagramUpstreamError) {
      if (e.retryable) throw e;
      await markFailed(prisma, row, e.code, e.message);
      return;
    }
    console.error('[worker-scrape] erro inesperado', row.id, e);
    await markFailed(
      prisma,
      row,
      'INTERNAL',
      truncateMessage(e instanceof Error ? e.message : 'Internal error.'),
    );
  }
}
