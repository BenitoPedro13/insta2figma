import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { billingCheckoutBodySchema } from '@insta2figma/shared-contracts';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { BillingService } from './billing.service';

type AuthedRequest = Request & { user: RequestUser };

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout-session')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async checkoutSession(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ) {
    const parsed = billingCheckoutBodySchema.safeParse(body ?? {});
    const plan = parsed.success ? parsed.data.plan : 'pro';
    return this.billing.createCheckoutSession(req.user.userId, plan);
  }

  @Post('portal-session')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async portalSession(@Req() req: AuthedRequest) {
    return this.billing.createPortalSession(req.user.userId);
  }
}
