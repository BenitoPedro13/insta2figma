import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Job, JobStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { SCRAPE_INSTAGRAM_V1_QUEUE } from '../queue/scrape-queue.name';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';
import { StorageService } from '../storage/storage.service';

import type { JobSignedAssetDto } from '@insta2figma/shared-contracts';

export type { JobSignedAssetDto };

export type JobResponse = {
  id: string;
  type: string;
  input: Prisma.JsonValue;
  status: JobStatus;
  resultSummary: Prisma.JsonValue | null;
  resultStoragePrefix: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Presente apenas com `GET /v1/jobs/:id?include=signedAssets` e job succeeded. */
  signedAssets?: JobSignedAssetDto[];
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly plan: PlanService,
    @InjectQueue(SCRAPE_INSTAGRAM_V1_QUEUE)
    private readonly scrapeQueue: Queue,
  ) {}

  toResponse(job: Job, extras?: { signedAssets?: JobSignedAssetDto[] }): JobResponse {
    return {
      id: job.id,
      type: job.type,
      input: job.input,
      status: job.status,
      resultSummary: job.resultSummary,
      resultStoragePrefix: job.resultStoragePrefix,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      idempotencyKey: job.idempotencyKey,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      ...(extras?.signedAssets !== undefined && {
        signedAssets: extras.signedAssets,
      }),
    };
  }

  async create(
    userId: string,
    body: unknown,
    idempotencyKeyRaw: string | undefined,
  ): Promise<JobResponse> {
    const { createJobBodySchema } = await import('@insta2figma/shared-contracts');
    const parsed = createJobBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid job body.',
        details: parsed.error.flatten(),
      });
    }

    const key = idempotencyKeyRaw?.trim() || null;
    if (key) {
      const existing = await this.prisma.job.findUnique({
        where: {
          userId_idempotencyKey: { userId, idempotencyKey: key },
        },
      });
      if (existing) {
        return this.toResponse(existing);
      }
    }

    const data = parsed.data;
    const { imagesToReserve } = await this.plan.assertCanCreateJob(userId, data.input);

    const periodStart = await this.plan.ensureQuotaAnchorAndGetPeriodStart(userId);
    let job: Job;

    try {
      job = await this.prisma.$transaction(async (tx) => {
        await tx.usageCounter.upsert({
          where: {
            userId_periodStart: { userId, periodStart },
          },
          create: { userId, periodStart, imagesUsed: imagesToReserve },
          update: { imagesUsed: { increment: imagesToReserve } },
        });
        return tx.job.create({
          data: {
            userId,
            type: data.type,
            input: data.input as unknown as Prisma.InputJsonValue,
            idempotencyKey: key ?? undefined,
            status: 'queued',
          },
        });
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        key
      ) {
        const existing = await this.prisma.job.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey: key },
          },
        });
        if (existing) return this.toResponse(existing);
      }
      throw e;
    }

    try {
      await this.scrapeQueue.add(
        'run',
        { jobId: job.id },
        {
          attempts: 6,
          backoff: { type: 'exponential', delay: 3000 },
          jobId: job.id,
        },
      );
    } catch (_enqueueErr) {
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          errorCode: 'QUEUE_UNAVAILABLE',
          errorMessage: 'Redis or BullMQ unavailable while enqueueing.',
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException(
        'Queue unavailable; the job was marked as failed.',
      );
    }

    return this.toResponse(job);
  }

  async getOne(
    userId: string,
    jobId: string,
    opts?: { signedAssets?: boolean },
  ): Promise<JobResponse> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found.');
    }
    if (job.userId !== userId) {
      throw new ForbiddenException('You do not have access to this job.');
    }

    if (
      opts?.signedAssets &&
      job.status === 'succeeded' &&
      this.storage.isConfigured()
    ) {
      const assets = await this.prisma.asset.findMany({
        where: { jobId },
        orderBy: { id: 'asc' },
      });
      const signed = await this.storage.signGetObjects(
        assets.map((a) => a.storageKey),
      );
      const keyToUrl = new Map(
        signed.map((s) => [s.storageKey, s] as const),
      );
      const signedAssets: JobSignedAssetDto[] = assets
        .map((a) => {
          const s = keyToUrl.get(a.storageKey);
          if (!s) return null;
          return {
            id: a.id,
            storageKey: a.storageKey,
            contentType: a.contentType,
            url: s.url,
            expiresAt: s.expiresAt,
          };
        })
        .filter((x): x is JobSignedAssetDto => x !== null);

      console.info(
        `[jobs] signedAssets jobId=${jobId} — ${assets.length} assets no DB, ${signedAssets.length} assinados`,
        signedAssets.map((a) => ({ key: a.storageKey, urlPrefix: a.url.slice(0, 60) })),
      );

      return this.toResponse(job, { signedAssets });
    }

    if (opts?.signedAssets && job.status === 'succeeded') {
      return this.toResponse(job, { signedAssets: [] });
    }

    return this.toResponse(job);
  }
}
