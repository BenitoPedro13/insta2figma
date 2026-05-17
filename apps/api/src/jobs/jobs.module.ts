import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlanModule } from '../plan/plan.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuthModule, PlanModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
