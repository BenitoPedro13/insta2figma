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
  estimateImagesForJobInput,
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
          'Quota mensal de imagens esgotada. Faz upgrade para Pro para continuar a importar.',
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
      freeImagesPerMonth: Number.parseInt(
        this.config.get<string>('QUOTA_FREE_IMAGES_PER_MONTH') ?? '100',
        10,
      ),
      proImagesPerMonth: Number.parseInt(
        this.config.get<string>('QUOTA_PRO_IMAGES_PER_MONTH') ?? '10000',
        10,
      ),
      maxPostsPerJob: Number.parseInt(
        this.config.get<string>('QUOTA_MAX_POSTS_PER_JOB') ?? '50',
        10,
      ),
    };
  }

  getLimitsForTier(planTier: string) {
    return getPlanLimits(planTier, this.envLimits());
  }

  async getImagesUsedThisPeriod(userId: string): Promise<number> {
    const periodStart = currentPeriodStartUtc();
    const counter = await this.prisma.usageCounter.findUnique({
      where: {
        userId_periodStart: { userId, periodStart },
      },
    });
    return counter?.imagesUsed ?? 0;
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
    const imagesUsed = await this.getImagesUsedThisPeriod(userId);

    const imagesLimit = limits.imagesPerMonth;
    const imagesRemaining = Math.max(0, imagesLimit - imagesUsed);

    const sub = user.subscriptions[0];
    return {
      userId: user.id,
      planTier,
      quotas: {
        imagesRemaining,
        imagesLimit,
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
    input: ScrapeSelectionInput & { expandCarouselImages?: boolean; estimatedImportImages?: number },
  ): Promise<{ planTier: PlanTier; imagesToReserve: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado.');
    }
    const planTier = normalizePlanTier(user.planTier);
    const limits = this.getLimitsForTier(planTier);

    const imagesToReserve = estimateImagesForJobInput(input, {
      defaultMaxPosts: limits.maxPosts,
    });

    if (input.expandCarouselImages && !limits.expandCarouselImages) {
      throw new JobInputPlanException(
        'Expandir carrossel está disponível apenas no plano Pro.',
      );
    }

    const imagesUsed = await this.getImagesUsedThisPeriod(userId);
    if (imagesUsed + imagesToReserve > limits.imagesPerMonth) {
      throw new QuotaExceededException();
    }

    return { planTier, imagesToReserve };
  }

  async getPlanTierForUser(userId: string): Promise<PlanTier> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado.');
    }
    return normalizePlanTier(user.planTier);
  }
}
