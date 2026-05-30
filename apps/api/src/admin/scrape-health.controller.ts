import { Controller, ForbiddenException, Get, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Controller('admin')
export class ScrapeHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get('scrape-health')
  async getScrapeHealth(
    @Headers('x-admin-key') key?: string,
  ) {
    const adminKey = this.config.get<string>('ADMIN_KEY')?.trim();
    if (!adminKey || key !== adminKey) {
      throw new ForbiddenException('Invalid or missing admin key.');
    }

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await this.prisma.scrapeTelemetry.findMany({
      where: { createdAt: { gte: since } },
      select: {
        endpoint: true,
        sessionAccount: true,
        cacheHit: true,
        latencyMs: true,
        errorKind: true,
        statusCode: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const total = rows.length;
    const errors = rows.filter((r) => r.errorKind !== null).length;
    const cacheHits = rows.filter((r) => r.cacheHit).length;

    // Latências sem cache hits (cache hits têm latencyMs=0 e distorceriam percentis)
    const latencies = rows
      .filter((r) => !r.cacheHit)
      .map((r) => r.latencyMs)
      .sort((a, b) => a - b);

    const byErrorKind: Record<string, number> = {};
    for (const r of rows) {
      if (r.errorKind) {
        byErrorKind[r.errorKind] = (byErrorKind[r.errorKind] ?? 0) + 1;
      }
    }

    // Por sessão
    const sessionMap = new Map<string, { requests: number; errors: number }>();
    for (const r of rows) {
      const account = r.sessionAccount ?? '(sem sessão)';
      const entry = sessionMap.get(account) ?? { requests: 0, errors: 0 };
      entry.requests++;
      if (r.errorKind) entry.errors++;
      sessionMap.set(account, entry);
    }
    const sessions = [...sessionMap.entries()]
      .map(([account, s]) => ({
        account,
        requests: s.requests,
        errors: s.errors,
        errorRate: round2(s.requests > 0 ? s.errors / s.requests : 0),
      }))
      .sort((a, b) => b.errors - a.errors);

    // Por endpoint
    const endpointMap = new Map<
      string,
      { requests: number; errors: number; cacheHits: number; latencies: number[] }
    >();
    for (const r of rows) {
      const entry = endpointMap.get(r.endpoint) ?? {
        requests: 0,
        errors: 0,
        cacheHits: 0,
        latencies: [],
      };
      entry.requests++;
      if (r.errorKind) entry.errors++;
      if (r.cacheHit) entry.cacheHits++;
      else entry.latencies.push(r.latencyMs);
      endpointMap.set(r.endpoint, entry);
    }
    const endpoints = [...endpointMap.entries()]
      .map(([endpoint, e]) => {
        const sorted = e.latencies.sort((a, b) => a - b);
        return {
          endpoint,
          requests: e.requests,
          errors: e.errors,
          errorRate: round2(e.requests > 0 ? e.errors / e.requests : 0),
          cacheHitRate: round2(e.requests > 0 ? e.cacheHits / e.requests : 0),
          p50LatencyMs: percentile(sorted, 0.5),
          p95LatencyMs: percentile(sorted, 0.95),
        };
      })
      .sort((a, b) => b.requests - a.requests);

    return {
      window: '1h',
      generatedAt: new Date().toISOString(),
      summary: {
        totalRequests: total,
        errorRate: round2(total > 0 ? errors / total : 0),
        cacheHitRate: round2(total > 0 ? cacheHits / total : 0),
        p50LatencyMs: percentile(latencies, 0.5),
        p95LatencyMs: percentile(latencies, 0.95),
        byErrorKind,
      },
      sessions,
      endpoints,
    };
  }
}
