import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PolarService } from './polar.service';

@Module({
  controllers: [BillingController],
  providers: [PolarService, BillingService],
  exports: [BillingService, PolarService],
})
export class BillingModule {}
