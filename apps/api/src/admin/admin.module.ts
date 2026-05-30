import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ScrapeHealthController } from './scrape-health.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScrapeHealthController],
})
export class AdminModule {}
