import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { PlanModule } from '../plan/plan.module';
import { MeController } from './me.controller';

@Module({
  imports: [PlanModule, BillingModule],
  controllers: [MeController],
})
export class UsersModule {}
