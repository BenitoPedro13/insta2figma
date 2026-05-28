import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../plan/plan.module';
import { InstagramController } from './instagram.controller';
import { InstagramPreviewService } from './instagram-preview.service';

@Module({
  imports: [AuthModule, PlanModule],
  controllers: [InstagramController],
  providers: [InstagramPreviewService],
})
export class InstagramModule {}
