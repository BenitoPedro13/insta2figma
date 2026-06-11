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
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { FigmaAuthDto } from './dto/figma-auth.dto';
import { FramerAuthDto } from './dto/framer-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { MagicLinkDto } from './dto/magic-link.dto';
import { LinkFigmaDto } from './dto/link-figma.dto';
import { LinkFramerDto } from './dto/link-framer.dto';
import type { RequestUser } from './jwt.strategy';

type AuthedRequest = Request & { user: RequestUser };

const SUCCESS_HTML = (message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Insta2Figma</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;
         background:#f5f5f5;padding:24px}
    .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;
          width:100%;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:22px;font-weight:600;margin-bottom:8px}
    p{color:#666;font-size:15px;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>${message}</h1>
    <p>You can close this tab and return to Figma.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Insta2Figma</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;
         background:#f5f5f5;padding:24px}
    .card{background:#fff;border-radius:16px;padding:40px 32px;max-width:420px;
          width:100%;text-align:center;box-shadow:0 2px 16px rgba(0,0,0,.08)}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:22px;font-weight:600;margin-bottom:8px}
    p{color:#666;font-size:15px}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>Something went wrong</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // ─── legacy ───────────────────────────────────────────────────────────────

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto).then((t) => ({ ...t, tokenType: 'Bearer' as const }));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto).then((t) => ({ ...t, tokenType: 'Bearer' as const }));
  }

  @Post('figma')
  @HttpCode(HttpStatus.OK)
  authFigma(@Body() dto: FigmaAuthDto) {
    return this.auth.authFigma(dto).then((t) => ({ ...t, tokenType: 'Bearer' as const }));
  }

  @Post('framer')
  @HttpCode(HttpStatus.OK)
  authFramer(@Body() dto: FramerAuthDto) {
    return this.auth.authFramer(dto).then((t) => ({ ...t, tokenType: 'Bearer' as const }));
  }

  // ─── magic link ───────────────────────────────────────────────────────────

  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  async requestMagicLink(@Body() dto: MagicLinkDto) {
    const { pollingId } = await this.auth.requestMagicLink(dto.email);
    return { pollingId };
  }

  @Get('magic-link/verify')
  async verifyMagicLink(
    @Query('token') token: string,
    @Query('pollingId') pollingId: string,
    @Res() res: Response,
  ) {
    try {
      await this.auth.verifyMagicLink(token, pollingId);
      res.setHeader('Content-Type', 'text/html').status(200).send(SUCCESS_HTML('Signed in!'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid or expired link.';
      res.setHeader('Content-Type', 'text/html').status(400).send(ERROR_HTML(msg));
    }
  }

  // ─── google oauth ─────────────────────────────────────────────────────────

  @Get('google/start')
  @HttpCode(HttpStatus.OK)
  async startGoogle() {
    const { url, pollingId } = await this.auth.startGoogleOAuth();
    return { url, pollingId };
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.auth.handleGoogleCallback(code, state);
      res.setHeader('Content-Type', 'text/html').status(200).send(SUCCESS_HTML('Signed in with Google!'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      res.setHeader('Content-Type', 'text/html').status(400).send(ERROR_HTML(msg));
    }
  }

  // ─── polling ──────────────────────────────────────────────────────────────

  @Get('poll')
  @HttpCode(HttpStatus.OK)
  async poll(@Query('pollingId') pollingId: string) {
    return this.auth.pollAuth(pollingId);
  }

  // ─── refresh ──────────────────────────────────────────────────────────────

  @Post('refresh')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: AuthedRequest) {
    const tokens = await this.auth.refresh(req.user.userId);
    return { ...tokens, tokenType: 'Bearer' as const };
  }

  // ─── link figma user (authenticated) ─────────────────────────────────────

  @Post('link-figma')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async linkFigma(@Req() req: AuthedRequest, @Body() dto: LinkFigmaDto) {
    await this.auth.linkFigma(req.user.userId, dto.figmaUserId);
    return { ok: true };
  }

  // ─── link framer user (authenticated) ────────────────────────────────────

  @Post('link-framer')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async linkFramer(@Req() req: AuthedRequest, @Body() dto: LinkFramerDto) {
    await this.auth.linkFramer(req.user.userId, dto.framerUserId);
    return { ok: true };
  }
}
