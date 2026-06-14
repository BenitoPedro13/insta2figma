import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../plan/plan.module';
import { RedisCacheModule } from '../cache/redis-cache.module';
import { InstagramController } from './instagram.controller';
import { InstagramPreviewService } from './instagram-preview.service';
import { ScrapeTelemetryService } from './instagram-telemetry.service';
import { IgCatalogModule } from './catalog/ig-catalog.module';

@Module({
  imports: [AuthModule, PlanModule, RedisCacheModule, IgCatalogModule],
  controllers: [InstagramController],
  providers: [InstagramPreviewService, ScrapeTelemetryService],
})
export class InstagramModule {}
