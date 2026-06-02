import { Global, Module } from '@nestjs/common';
import { PlanEventsService } from './plan-events.service';

/**
 * Global para que tanto o BillingService (publica) como o MeController (espera)
 * possam injectar PlanEventsService sem dependências circulares de módulo.
 */
@Global()
@Module({
  providers: [PlanEventsService],
  exports: [PlanEventsService],
})
export class PlanEventsModule {}
