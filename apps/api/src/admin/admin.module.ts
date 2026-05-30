import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScrapeHealthController } from './scrape-health.controller';
import { SessionsController } from './sessions.controller';
import { SessionSyncService } from './session-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [ScrapeHealthController, SessionsController],
  providers: [SessionSyncService],
})
export class AdminModule {}
