import { Global, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { SCRAPE_INSTAGRAM_V1_QUEUE } from './scrape-queue.name';

let sharedRedisConnection: Redis | null = null;

function getRedisConnection(url: string): Redis {
  if (!sharedRedisConnection) {
    sharedRedisConnection = new Redis(url, { maxRetriesPerRequest: null });
  }
  return sharedRedisConnection;
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: getRedisConnection(
          config.getOrThrow<string>('REDIS_URL'),
        ),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: SCRAPE_INSTAGRAM_V1_QUEUE,
    }),
  ],
  exports: [BullModule],
})
export class QueueModule implements OnApplicationShutdown {
  private readonly log = new Logger(QueueModule.name);

  async onApplicationShutdown(): Promise<void> {
    if (!sharedRedisConnection) return;
    try {
      await sharedRedisConnection.quit();
    } finally {
      sharedRedisConnection = null;
    }
    this.log.log('Ligação Redis BullMQ terminada.');
  }
}
