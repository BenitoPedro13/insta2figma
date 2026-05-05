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
};

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SCRAPE_INSTAGRAM_V1_QUEUE)
    private readonly scrapeQueue: Queue,
  ) {}

  toResponse(job: Job): JobResponse {
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
        message: 'Body do job inválido.',
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
    let job: Job;

    try {
      job = await this.prisma.job.create({
        data: {
          userId,
          type: data.type,
          input: data.input as unknown as Prisma.InputJsonValue,
          idempotencyKey: key ?? undefined,
          status: 'queued',
        },
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
          errorMessage: 'Redis ou BullMQ indisponível ao enfileirar.',
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException(
        'Fila indisponível; o job foi marcado como falhado.',
      );
    }

    return this.toResponse(job);
  }

  async getOne(userId: string, jobId: string): Promise<JobResponse> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job não encontrado.');
    }
    if (job.userId !== userId) {
      throw new ForbiddenException('Sem acesso a este job.');
    }
    return this.toResponse(job);
  }
}
