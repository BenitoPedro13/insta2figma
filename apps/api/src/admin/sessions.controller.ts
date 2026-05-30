import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { globalSessionPool, REDIS_SESSION_KEY } from '@insta2figma/shared-instagram';
import type { SessionEntry } from '@insta2figma/shared-instagram';
import { REDIS_CACHE_CLIENT } from '../cache/redis-cache.module';

interface UpdateSessionsBody {
  sessions: SessionEntry[];
}

@Controller('admin')
export class SessionsController {
  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis,
  ) {}

  private checkKey(key: string | undefined): void {
    const adminKey = this.config.get<string>('ADMIN_KEY')?.trim();
    if (!adminKey || key !== adminKey) {
      throw new ForbiddenException('Invalid or missing admin key.');
    }
  }

  @Get('sessions')
  getSessions(@Headers('x-admin-key') key?: string) {
    this.checkKey(key);
    const entries = globalSessionPool.getStatus();
    return {
      count: globalSessionPool.size,
      activeCount: globalSessionPool.activeCount,
      sessions: entries,
    };
  }

  @Post('sessions')
  async updateSessions(
    @Headers('x-admin-key') key: string | undefined,
    @Body() body: UpdateSessionsBody,
  ) {
    this.checkKey(key);

    const sessions: SessionEntry[] = body?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new ForbiddenException('Body must be { sessions: [{ account, cookie, proxy? }] }');
    }

    for (const s of sessions) {
      if (!s.account || !s.cookie) {
        throw new ForbiddenException('Each session must have account and cookie.');
      }
    }

    await this.redis.set(REDIS_SESSION_KEY, JSON.stringify(sessions));
    globalSessionPool.reload(sessions);

    return {
      updated: true,
      count: sessions.length,
      accounts: sessions.map((s) => s.account),
    };
  }
}
