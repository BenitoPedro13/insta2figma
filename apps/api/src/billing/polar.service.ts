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

  getProProductId(): string {
    return this.config.getOrThrow<string>('POLAR_PRODUCT_ID_PRO');
  }

  getMaxProductId(): string | null {
    const id = this.config.get<string>('POLAR_PRODUCT_ID_MAX')?.trim();
    return id || null;
  }

  getProductIdForPlan(plan: 'pro' | 'max'): string {
    if (plan === 'max') {
      const maxId = this.getMaxProductId();
      if (!maxId) {
        throw new Error('POLAR_PRODUCT_ID_MAX em falta.');
      }
      return maxId;
    }
    return this.getProProductId();
  }
}
