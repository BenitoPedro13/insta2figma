import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { billingCheckoutBodySchema } from '@insta2figma/shared-contracts';
import type { Request, Response } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { BillingService } from './billing.service';

type AuthedRequest = Request & { user: RequestUser };

const FINAL_REDIRECT_URL = 'https://mainnet.design/';

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
    const cycle = parsed.success ? parsed.data.cycle : 'monthly';
    return this.billing.createCheckoutSession(req.user.userId, plan, cycle);
  }

  @Post('portal-session')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async portalSession(@Req() req: AuthedRequest) {
    return this.billing.createPortalSession(req.user.userId);
  }

  /**
   * Polar redireciona o browser aqui após pagamento bem-sucedido.
   * Faz sync imediato do estado do customer e notifica o long-poll do plugin.
   * POLAR_SUCCESS_URL deve apontar para este endpoint com ?userId= embutido.
   */
  @Get('checkout-success')
  async checkoutSuccess(
    @Query('userId') userId: string | undefined,
    @Res() res: Response,
  ) {
    if (userId) {
      try {
        await this.billing.syncCustomerState(userId, true);
      } catch (e) {
        // Não bloquear o redirect por falha de sync
        console.warn('[billing] checkout-success sync falhou', e);
      }
    }
    res.redirect(302, FINAL_REDIRECT_URL);
  }
}
