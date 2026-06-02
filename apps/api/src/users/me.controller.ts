import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { BillingService } from '../billing/billing.service';
import { PlanService } from '../plan/plan.service';
import { PlanEventsService } from '../plan/plan-events.service';

type AuthedRequest = Request & { user: RequestUser };

const LONG_POLL_HOLD_MS = 25_000;

@Controller()
export class MeController {
  constructor(
    private readonly plan: PlanService,
    private readonly billing: BillingService,
    private readonly planEvents: PlanEventsService,
  ) {}

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: AuthedRequest) {
    await this.billing.syncCustomerState(req.user.userId);
    return this.plan.buildMeResponse(req.user.userId);
  }

  @Get('me/plan-events')
  @UseGuards(AuthGuard('jwt'))
  async planEvents(
    @Req() req: AuthedRequest,
    @Query('currentTier') currentTier?: string,
  ) {
    const userId = req.user.userId;

    // Race condition: o plano já mudou antes de o long-poll abrir?
    let me = await this.plan.buildMeResponse(userId);
    if (currentTier && me.planTier !== currentTier) {
      return { changed: true, ...me };
    }

    // Segurar a ligação até o evento chegar ou o timeout expirar
    const notified = await this.planEvents.waitForChange(userId, LONG_POLL_HOLD_MS);

    if (notified) {
      me = await this.plan.buildMeResponse(userId);
      return { changed: !currentTier || me.planTier !== currentTier, ...me };
    }

    // Timeout: rede de segurança caso o webhook do Polar não tenha chegado
    await this.billing.syncCustomerState(userId, true);
    me = await this.plan.buildMeResponse(userId);
    return { changed: !!currentTier && me.planTier !== currentTier, ...me };
  }
}
