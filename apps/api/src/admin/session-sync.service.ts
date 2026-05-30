import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { globalSessionPool, REDIS_SESSION_KEY } from '@insta2figma/shared-instagram';
import type { SessionEntry } from '@insta2figma/shared-instagram';
import { REDIS_CACHE_CLIENT } from '../cache/redis-cache.module';

const POLL_INTERVAL_MS = 60_000;

@Injectable()
export class SessionSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(SessionSyncService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis) {}

  onApplicationBootstrap(): void {
    // Carrega imediatamente do Redis ao arrancar, depois a cada 60s
    void this.syncFromRedis();
    this.timer = setInterval(() => void this.syncFromRedis(), POLL_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async syncFromRedis(): Promise<void> {
    try {
      const raw = await this.redis.get(REDIS_SESSION_KEY);
      if (!raw) return;
      const sessions = JSON.parse(raw) as SessionEntry[];
      if (Array.isArray(sessions) && sessions.length > 0) {
        globalSessionPool.reload(sessions);
      }
    } catch (e) {
      this.log.warn('Falha ao sincronizar sessões do Redis', e);
    }
  }
}
