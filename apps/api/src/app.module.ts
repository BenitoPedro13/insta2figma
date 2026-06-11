import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { RedisCacheModule } from './cache/redis-cache.module';
import { AuthModule } from './auth/auth.module';
import { PlanEventsModule } from './plan/plan-events.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { InstagramModule } from './instagram/instagram.module';
import { BillingModule } from './billing/billing.module';
import { UsersModule } from './users/users.module';
import { FeedbackModule } from './feedback/feedback.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    StorageModule,
    QueueModule,
    RedisCacheModule,
    AuthModule,
    PlanEventsModule,
    JobsModule,
    HealthModule,
    AdminModule,
    InstagramModule,
    BillingModule,
    UsersModule,
    FeedbackModule,
  ],
})
export class AppModule {}
