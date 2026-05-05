import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Job, JobStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
    try {
      const job = await this.prisma.job.create({
        data: {
          userId,
          type: data.type,
          input: data.input as unknown as Prisma.InputJsonValue,
          idempotencyKey: key ?? undefined,
          status: 'queued',
        },
      });
      return this.toResponse(job);
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
