import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ScrapeTelemetryEvent {
  endpoint: string;
  igUsername: string;
  sessionAccount: string | null;
  proxyUsed: boolean;
  cacheHit: boolean;
  statusCode: number;
  retryCount: number;
  latencyMs: number;
  errorKind: string | null;
  userId?: string | null;
  planTier?: string | null;
}

@Injectable()
export class ScrapeTelemetryService {
  constructor(private readonly prisma: PrismaService) {}

  record(event: ScrapeTelemetryEvent): void {
    this.prisma.scrapeTelemetry
      .create({
        data: {
          endpoint: event.endpoint,
          igUsername: event.igUsername,
          sessionAccount: event.sessionAccount,
          proxyUsed: event.proxyUsed,
          cacheHit: event.cacheHit,
          statusCode: event.statusCode,
          retryCount: event.retryCount,
          latencyMs: event.latencyMs,
          errorKind: event.errorKind,
          userId: event.userId ?? null,
          planTier: event.planTier ?? null,
        },
      })
      .catch((err: unknown) => {
        console.error('[scrape-telemetry] Falha ao registar evento:', err);
      });
  }
}
