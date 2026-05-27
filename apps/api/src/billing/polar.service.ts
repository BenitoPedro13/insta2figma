import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Polar } from '@polar-sh/sdk';

@Injectable()
export class PolarService {
  private readonly logger = new Logger(PolarService.name);
  private client: Polar | null = null;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('POLAR_ACCESS_TOKEN')?.trim());
  }

  getClient(): Polar {
    if (!this.isConfigured()) {
      throw new Error('Polar não configurado (POLAR_ACCESS_TOKEN em falta).');
    }
    if (!this.client) {
      const server =
        this.config.get<string>('POLAR_SERVER')?.trim() === 'production'
          ? 'production'
          : 'sandbox';
      this.client = new Polar({
        accessToken: this.config.getOrThrow<string>('POLAR_ACCESS_TOKEN'),
        server,
      });
      this.logger.log(`Polar SDK inicializado (${server})`);
    }
    return this.client;
  }

  private getEnvId(key: string): string | null {
    const id = this.config.get<string>(key)?.trim();
    return id || null;
  }

  getProductId(plan: 'pro' | 'max', cycle: 'monthly' | 'yearly'): string | null {
    const key = `POLAR_PRODUCT_ID_${plan.toUpperCase()}_${cycle.toUpperCase()}`;
    const direct = this.getEnvId(key);
    if (direct) return direct;
    // Fallback compatível com a env antiga (sem ciclo).
    if (cycle === 'monthly') {
      const legacy = this.getEnvId(`POLAR_PRODUCT_ID_${plan.toUpperCase()}`);
      if (legacy) return legacy;
    }
    return null;
  }

  getProductIdForPlan(
    plan: 'pro' | 'max',
    cycle: 'monthly' | 'yearly' = 'monthly',
  ): string {
    const id = this.getProductId(plan, cycle);
    if (!id) {
      throw new Error(
        `POLAR_PRODUCT_ID_${plan.toUpperCase()}_${cycle.toUpperCase()} em falta.`,
      );
    }
    return id;
  }

  /** Todos os product IDs conhecidos para um tier (monthly + yearly). */
  getAllProductIdsForPlan(plan: 'pro' | 'max'): string[] {
    const ids = [
      this.getProductId(plan, 'monthly'),
      this.getProductId(plan, 'yearly'),
    ].filter((id): id is string => Boolean(id));
    return Array.from(new Set(ids));
  }
}
