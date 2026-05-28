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
  resolveQuotaPeriod,
  type MeResponse,
  type PlanTier,
  type ScrapeSelectionInput,
} from '@insta2figma/shared-contracts';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanLimits, normalizePlanTier } from './plan.config';

export class QuotaExceededException extends HttpException {
  constructor(planTier: PlanTier) {
    const upgradeHint =
      planTier === 'max'
        ? 'Monthly quota exhausted.'
        : planTier === 'pro'
          ? 'Monthly quota exhausted. Upgrade to Max to keep importing.'
          : 'Monthly image quota exhausted. Upgrade to Pro or Max to keep importing.';
    super(
      {
        code: QUOTA_EXCEEDED_ERROR_CODE,
        message: upgradeHint,
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
      maxImagesPerMonth: Number.parseInt(
        this.config.get<string>('QUOTA_MAX_IMAGES_PER_MONTH') ?? '100000',
        10,
      ),
      maxPostsPerJob: Number.parseInt(
        this.config.get<string>('QUOTA_MAX_POSTS_PER_JOB') ?? '50',
        10,
      ),
      maxImagesPerJob: Number.parseInt(
        this.config.get<string>('QUOTA_MAX_IMAGES_PER_JOB') ?? '100',
        10,
      ),
    };
  }

  getLimitsForTier(planTier: string) {
    return getPlanLimits(planTier, this.envLimits());
  }

  async getQuotaPeriodForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { quotaAnchorAt: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return resolveQuotaPeriod(user.quotaAnchorAt);
  }

  /** Define quotaAnchorAt no primeiro import e devolve periodStart para o contador. */
  async ensureQuotaAnchorAndGetPeriodStart(userId: string): Promise<Date> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { quotaAnchorAt: true },
    });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    let anchor = user.quotaAnchorAt;
    if (!anchor) {
      anchor = new Date();
      await this.prisma.user.update({
        where: { id: userId },
        data: { quotaAnchorAt: anchor },
      });
    }

    return resolveQuotaPeriod(anchor).periodStart;
  }

  async getImagesUsedThisPeriod(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { quotaAnchorAt: true },
    });
    if (!user?.quotaAnchorAt) {
      return 0;
    }

    const periodStart = resolveQuotaPeriod(user.quotaAnchorAt).periodStart;
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
      throw new NotFoundException('User not found.');
    }

    const planTier = normalizePlanTier(user.planTier);
    const limits = this.getLimitsForTier(planTier);
    const imagesUsed = await this.getImagesUsedThisPeriod(userId);

    const imagesLimit = limits.imagesPerMonth;
    const imagesRemaining = Math.max(0, imagesLimit - imagesUsed);
    const quotaPeriod = resolveQuotaPeriod(user.quotaAnchorAt);

    const sub = user.subscriptions[0];
    return {
      userId: user.id,
      planTier,
      quotas: {
        imagesRemaining,
        imagesLimit,
        maxPosts: limits.maxPosts,
        maxImagesPerJob: limits.maxImagesPerJob,
        expandCarouselImages: limits.expandCarouselImages,
        periodEnd: quotaPeriod.anchored
          ? quotaPeriod.periodEnd.toISOString()
          : null,
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
      throw new NotFoundException('User not found.');
    }
    const planTier = normalizePlanTier(user.planTier);
    const limits = this.getLimitsForTier(planTier);

    const imagesToReserve = estimateImagesForJobInput(input, {
      defaultMaxPosts: limits.maxPosts,
    });

    if (imagesToReserve > limits.maxImagesPerJob) {
      throw new JobInputPlanException(
        `Each import can use at most ${limits.maxImagesPerJob} images at once. Reduce your selection or turn off carousel expansion.`,
      );
    }

    if (input.expandCarouselImages && !limits.expandCarouselImages) {
      throw new JobInputPlanException(
        'Carousel expansion is only available on paid plans.',
      );
    }

    const imagesUsed = await this.getImagesUsedThisPeriod(userId);
    if (imagesUsed + imagesToReserve > limits.imagesPerMonth) {
      throw new QuotaExceededException(planTier);
    }

    return { planTier, imagesToReserve };
  }

  async getPlanTierForUser(userId: string): Promise<PlanTier> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }
    return normalizePlanTier(user.planTier);
  }
}
