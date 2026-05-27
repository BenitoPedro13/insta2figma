import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** Polar customer state (shape mínimo usado internamente). */
type PolarCustomerState = {
  id: string;
  activeSubscriptions?: PolarSubscriptionState[];
};

type PolarSubscriptionState = {
  id: string;
  productId: string;
  status: string;
  currentPeriodEnd?: Date | null;
};
import {
  emailForPolar,
  formatPolarError,
  isPolarSdkNotFound,
  isPolarSdkValidation,
  shouldOmitCheckoutCustomerEmail,
} from './polar-email.util';
import { PolarService } from './polar.service';
import type {
  BillingCheckoutPlan,
  BillingCycle,
} from '@insta2figma/shared-contracts';

type WebhookPayload = {
  type?: string;
  data?: Record<string, unknown>;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly syncCache = new Map<string, number>();
  private static readonly SYNC_TTL_MS = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly polar: PolarService,
    private readonly config: ConfigService,
  ) {}

  async ensurePolarCustomer(
    userId: string,
    opts?: { email?: string; name?: string },
  ): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (user.polarCustomerId) {
      return user.polarCustomerId;
    }

    if (!this.polar.isConfigured()) {
      throw new ServiceUnavailableException('Billing Polar não configurado.');
    }

    const client = this.polar.getClient();
    const placeholderDomain =
      this.config.get<string>('POLAR_SYNTHETIC_EMAIL_DOMAIN')?.trim() ||
      undefined;
    const email = emailForPolar(user, placeholderDomain);

    try {
      const customer = await client.customers.create({
        email,
        externalId: userId,
        name: opts?.name ?? null,
      });
      await this.prisma.user.update({
        where: { id: userId },
        data: { polarCustomerId: customer.id },
      });
      return customer.id;
    } catch (err) {
      if (isPolarSdkValidation(err)) {
        throw new BadRequestException(
          `Polar: ${formatPolarError(err)}`,
        );
      }
      this.logger.warn(
        `customers.create falhou para ${userId}, a tentar state external`,
        err,
      );
      try {
        const state = await client.customers.getStateExternal({
          externalId: userId,
        });
        const polarId = this.extractCustomerId(state);
        await this.prisma.user.update({
          where: { id: userId },
          data: { polarCustomerId: polarId },
        });
        return polarId;
      } catch (stateErr) {
        if (isPolarSdkNotFound(stateErr)) {
          throw new ServiceUnavailableException(
            'Não foi possível criar o cliente Polar. Tenta novamente.',
          );
        }
        throw stateErr;
      }
    }
  }

  async createCheckoutSession(
    userId: string,
    plan: BillingCheckoutPlan = 'pro',
    cycle: BillingCycle = 'monthly',
  ): Promise<{ url: string }> {
    if (!this.polar.isConfigured()) {
      throw new ServiceUnavailableException('Billing Polar não configurado.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const placeholderDomain =
      this.config.get<string>('POLAR_SYNTHETIC_EMAIL_DOMAIN')?.trim() ||
      undefined;
    const polarEmail = emailForPolar(user, placeholderDomain);

    const client = this.polar.getClient();
    let productId: string;
    try {
      productId = this.polar.getProductIdForPlan(plan, cycle);
    } catch {
      throw new BadRequestException(
        `Plano ${plan} (${cycle}) ainda não configurado (POLAR_PRODUCT_ID_${plan.toUpperCase()}_${cycle.toUpperCase()}).`,
      );
    }
    const successUrl =
      this.config.get<string>('POLAR_SUCCESS_URL')?.trim() ||
      'https://insta2figma.com/billing/success';
    const returnUrl = this.config.get<string>('POLAR_RETURN_URL')?.trim();

    try {
      const checkout = await client.checkouts.create({
        products: [productId],
        externalCustomerId: userId,
        ...(shouldOmitCheckoutCustomerEmail(polarEmail)
          ? {}
          : { customerEmail: polarEmail }),
        successUrl,
        returnUrl: returnUrl || undefined,
        metadata: { userId, plan, cycle },
      });

      if (!checkout.url) {
        throw new BadRequestException('Checkout Polar sem URL.');
      }
      return { url: checkout.url };
    } catch (err) {
      this.logger.error('checkouts.create falhou', err);
      if (isPolarSdkValidation(err)) {
        throw new BadRequestException(
          `Checkout inválido: ${formatPolarError(err)}. Verifica POLAR_PRODUCT_ID_${plan.toUpperCase()}_${cycle.toUpperCase()} (sandbox).`,
        );
      }
      throw new ServiceUnavailableException(
        'Não foi possível criar a sessão de checkout.',
      );
    }

  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    if (!this.polar.isConfigured()) {
      throw new ServiceUnavailableException('Billing Polar não configurado.');
    }
    const polarCustomerId = await this.ensurePolarCustomer(userId);
    const client = this.polar.getClient();
    const returnUrl = this.config.get<string>('POLAR_RETURN_URL')?.trim();

    const session = await client.customerSessions.create({
      customerId: polarCustomerId,
      returnUrl: returnUrl || undefined,
    });

    return { url: session.customerPortalUrl };
  }

  async syncCustomerState(userId: string, force = false): Promise<void> {
    if (!this.polar.isConfigured()) return;

    const now = Date.now();
    const cached = this.syncCache.get(userId);
    if (!force && cached != null && now - cached < BillingService.SYNC_TTL_MS) {
      return;
    }

    try {
      const client = this.polar.getClient();
      const state = await client.customers.getStateExternal({
        externalId: userId,
      });
      await this.applyCustomerState(userId, state);
      this.syncCache.set(userId, now);
    } catch (err) {
      if (isPolarSdkNotFound(err)) {
        return;
      }
      this.logger.warn(`syncCustomerState falhou para ${userId}`, err);
    }
  }

  async handleWebhook(eventType: string, payload: WebhookPayload): Promise<void> {
    const eventId = this.extractEventId(payload);
    if (!eventId) {
      this.logger.warn(`Webhook sem event id (${eventType})`);
      return;
    }

    const existing = await this.prisma.webhookEvent.findUnique({
      where: { polarEventId: eventId },
    });
    if (existing) {
      return;
    }

    const userId = this.extractUserIdFromPayload(payload);
    if (userId) {
      if (eventType === 'customer.state_changed') {
        const data = payload.data as PolarCustomerState | undefined;
        if (data) {
          await this.applyCustomerState(userId, data);
        } else {
          await this.syncCustomerState(userId, true);
        }
      } else if (
        eventType.startsWith('subscription.') ||
        eventType === 'order.paid'
      ) {
        await this.syncCustomerState(userId, true);
      }
    } else {
      this.logger.debug(`Webhook ${eventType} sem userId mapeável`);
    }

    await this.prisma.webhookEvent.create({
      data: { polarEventId: eventId, eventType },
    });
  }

  private async applyCustomerState(
    userId: string,
    state: PolarCustomerState,
  ): Promise<void> {
    const polarCustomerId = this.extractCustomerId(state);
    const maxIds = this.polar.isConfigured()
      ? this.polar.getAllProductIdsForPlan('max')
      : [];
    const proIds = this.polar.isConfigured()
      ? this.polar.getAllProductIdsForPlan('pro')
      : [];

    const subs = this.extractActiveSubscriptions(state);
    const maxSub = subs.find((s) => maxIds.includes(s.productId)) ?? null;
    const proSub = !maxSub
      ? (subs.find((s) => proIds.includes(s.productId)) ?? null)
      : null;
    const activeSub = maxSub ?? proSub ?? null;

    const planTier = maxSub ? 'max' : proSub ? 'pro' : 'free';

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        polarCustomerId,
        planTier,
      },
    });

    if (activeSub) {
      await this.prisma.subscription.upsert({
        where: { polarSubscriptionId: activeSub.id },
        create: {
          userId,
          polarSubscriptionId: activeSub.id,
          productId: activeSub.productId,
          status: String(activeSub.status),
          currentPeriodEnd: activeSub.currentPeriodEnd ?? null,
        },
        update: {
          status: String(activeSub.status),
          currentPeriodEnd: activeSub.currentPeriodEnd ?? null,
        },
      });
    }
  }

  private extractCustomerId(state: PolarCustomerState): string {
    if ('id' in state && typeof state.id === 'string') {
      return state.id;
    }
    throw new Error('Customer state sem id');
  }

  private extractActiveSubscriptions(
    state: PolarCustomerState,
  ): PolarSubscriptionState[] {
    if ('activeSubscriptions' in state && Array.isArray(state.activeSubscriptions)) {
      return state.activeSubscriptions;
    }
    return [];
  }

  private extractEventId(payload: WebhookPayload): string | null {
    const data = payload.data;
    if (data && typeof data === 'object') {
      if (typeof data.id === 'string') return data.id;
    }
    if (typeof (payload as { id?: string }).id === 'string') {
      return (payload as { id: string }).id;
    }
    return null;
  }

  private extractUserIdFromPayload(payload: WebhookPayload): string | null {
    const data = payload.data;
    if (!data || typeof data !== 'object') return null;

    const meta = data.metadata as Record<string, unknown> | undefined;
    if (meta && typeof meta.userId === 'string') return meta.userId;

    if (typeof data.externalId === 'string') return data.externalId;
    if (typeof data.externalCustomerId === 'string') {
      return data.externalCustomerId;
    }

    const customer = data.customer as Record<string, unknown> | undefined;
    if (customer && typeof customer.externalId === 'string') {
      return customer.externalId;
    }

    return null;
  }
}
