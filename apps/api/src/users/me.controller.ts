import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { BillingService } from '../billing/billing.service';
import { PlanService } from '../plan/plan.service';

type AuthedRequest = Request & { user: RequestUser };

@Controller()
export class MeController {
  constructor(
    private readonly plan: PlanService,
    private readonly billing: BillingService,
  ) {}

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: AuthedRequest) {
    await this.billing.syncCustomerState(req.user.userId);
    return this.plan.buildMeResponse(req.user.userId);
  }
}
