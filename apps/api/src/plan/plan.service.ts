import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QUOTA_EXCEEDED_ERROR_CODE,
  endSelectionIndex,
  resolveScrapeSelection,
  type MeResponse,
  type PlanTier,
  type ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  currentPeriodStartUtc,
  getPlanLimits,
  normalizePlanTier,
} from './plan.config';

export class QuotaExceededException extends HttpException {
  constructor() {
    super(
      {
        code: QUOTA_EXCEEDED_ERROR_CODE,
        message:
          'Quota mensal esgotada. Faz upgrade para Pro para continuar a importar.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class JobInputPlanException extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}

@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private envLimits() {
    return {
      freeJobsPerMonth: Number.parseInt(
        this.config.get<string>('QUOTA_FREE_JOBS_PER_MONTH') ?? '3',
        10,
      ),
      freeMaxPosts: Number.parseInt(
        this.config.get<string>('QUOTA_FREE_MAX_POSTS') ?? '12',
        10,
      ),
      proMaxPosts: Number.parseInt(
        this.config.get<string>('QUOTA_PRO_MAX_POSTS') ?? '50',
        10,
      ),
    };
  }

  getLimitsForTier(planTier: string) {
    return getPlanLimits(planTier, this.envLimits());
  }

  async getJobsUsedThisPeriod(userId: string): Promise<number> {
    const periodStart = currentPeriodStartUtc();
    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        userId_periodStart: { userId, periodStart },
      },
    });
    return counter?.jobsUsed ?? 0;
  }

  async buildMeResponse(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        subscriptions: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado.');
    }

    const planTier = normalizePlanTier(user.planTier);
    const limits = this.getLimitsForTier(planTier);
    const jobsUsed = await this.getJobsUsedThisPeriod(userId);

    const jobsLimit = limits.jobsPerMonth;
    const jobsRemaining =
      jobsLimit == null ? null : Math.max(0, jobsLimit - jobsUsed);

    const sub = user.subscriptions[0];
    return {
      userId: user.id,
      planTier,
      quotas: {
        jobsRemaining,
        jobsLimit,
        maxPosts: limits.maxPosts,
        expandCarouselImages: limits.expandCarouselImages,
      },
      ...(sub && {
        subscription: {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        },
      }),
    };
  }

  async assertCanCreateJob(
    userId: string,
    input: ScrapeSelectionInput & { expandCarouselImages?: boolean },
  ): Promise<{ planTier: PlanTier }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado.');
    }
    const planTier = normalizePlanTier(user.planTier);
    const limits = this.getLimitsForTier(planTier);

    const selection = resolveScrapeSelection(input, {
      defaultMaxPosts: limits.maxPosts,
    });
    const endIndex = endSelectionIndex(selection);

    if (selection.postCount > limits.maxPosts) {
      throw new JobInputPlanException(
        `O plano ${planTier} permite importar no máximo ${limits.maxPosts} posts por job.`,
      );
    }
    if (endIndex > limits.maxPosts || selection.fetchCount > limits.maxPosts) {
      throw new JobInputPlanException(
        `O plano ${planTier} cobre até a posição #${limits.maxPosts}. O pedido precisa até #${endIndex}.`,
      );
    }
    if (input.expandCarouselImages && !limits.expandCarouselImages) {
      throw new JobInputPlanException(
        'Expandir carrossel está disponível apenas no plano Pro.',
      );
    }

    if (limits.jobsPerMonth != null) {
      const used = await this.getJobsUsedThisPeriod(userId);
      if (used >= limits.jobsPerMonth) {
        throw new QuotaExceededException();
      }
    }

    return { planTier };
  }

  async getPlanTierForUser(userId: string): Promise<PlanTier> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado.');
    }
    return normalizePlanTier(user.planTier);
  }
}
