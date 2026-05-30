import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CACHE_CLIENT = Symbol('REDIS_CACHE_CLIENT');

let cacheConnection: Redis | null = null;

function getCacheConnection(url: string): Redis {
  if (!cacheConnection) {
    cacheConnection = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return cacheConnection;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CACHE_CLIENT,
      useFactory: (config: ConfigService): Redis =>
        getCacheConnection(config.getOrThrow<string>('REDIS_URL')),
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CACHE_CLIENT],
})
export class RedisCacheModule implements OnApplicationShutdown {
  private readonly log = new Logger(RedisCacheModule.name);

  async onApplicationShutdown(): Promise<void> {
    if (!cacheConnection) return;
    try {
      await cacheConnection.quit();
    } finally {
      cacheConnection = null;
    }
    this.log.log('Ligação Redis cache terminada.');
  }
}
