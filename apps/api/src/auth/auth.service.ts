import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import type { FigmaAuthDto } from './dto/figma-auth.dto';
import type { JwtPayload } from './auth-token.payload';

function figmaSyntheticEmail(figmaUserId: string): string {
  const safe = figmaUserId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 48);
  return `figma+${safe}@mailinator.com`;
}

const LEGACY_EMAIL_SUFFIXES = ['@users.insta2figma.app', '@example.com'];

function isLegacySyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return LEGACY_EMAIL_SUFFIXES.some((s) => lower.endsWith(s));
}

function isSyntheticEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return isLegacySyntheticEmail(email) || email.toLowerCase().includes('@mailinator.com');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ─── existing figma auth (kept for backwards compatibility) ──────────────

  async authFigma(
    dto: FigmaAuthDto,
  ): Promise<{ accessToken: string; expiresIn: string; userId: string }> {
    const figmaUserId = dto.figmaUserId.trim();
    let user = await this.prisma.user.findUnique({ where: { figmaUserId } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { figmaUserId, email: figmaSyntheticEmail(figmaUserId) },
      });
    } else if (isLegacySyntheticEmail(user.email)) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { email: figmaSyntheticEmail(figmaUserId) },
      });
    }
    const tokens = this.signForUser(user.id);
    return { ...tokens, userId: user.id };
  }

  // ─── magic link ──────────────────────────────────────────────────────────

  async requestMagicLink(
    emailInput: string,
  ): Promise<{ pollingId: string }> {
    const emailNorm = emailInput.trim().toLowerCase();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      throw new BadRequestException('Invalid email address.');
    }

    // Clean expired tokens for this email
    await this.prisma.authToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    const token = randomBytes(32).toString('hex');
    const pollingId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await this.prisma.authToken.create({
      data: { token, pollingId, type: 'magic_link', email: emailNorm, expiresAt },
    });

    const publicUrl = this.config.get<string>('PUBLIC_API_URL')?.trim() ?? '';
    const link = `${publicUrl}/v1/auth/magic-link/verify?token=${token}&pollingId=${pollingId}`;

    await this.email.sendMagicLink(emailNorm, link);

    return { pollingId };
  }

  async verifyMagicLink(token: string, pollingId: string): Promise<void> {
    const record = await this.prisma.authToken.findUnique({ where: { token } });
    if (!record || record.type !== 'magic_link' || record.pollingId !== pollingId) {
      throw new NotFoundException('Invalid or expired link.');
    }
    if (record.expiresAt < new Date()) {
      await this.prisma.authToken.delete({ where: { id: record.id } });
      throw new UnauthorizedException('Link expired. Please request a new one.');
    }
    if (record.jwt) return; // already verified

    const emailNorm = record.email?.trim().toLowerCase();
    if (!emailNorm) throw new BadRequestException('Token missing email.');

    let user = await this.prisma.user.findFirst({ where: { email: emailNorm } });
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: emailNorm, emailVerified: true },
      });
    } else if (!user.emailVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }

    const { accessToken } = this.signForUser(user.id);
    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { userId: user.id, jwt: accessToken },
    });
  }

  // ─── google oauth ────────────────────────────────────────────────────────

  async startGoogleOAuth(): Promise<{ url: string; pollingId: string }> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim();
    if (!clientId || !callbackUrl) {
      throw new BadRequestException('Google OAuth not configured.');
    }

    const state = randomBytes(16).toString('hex');
    const pollingId = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await this.prisma.authToken.create({
      data: { token: state, pollingId, type: 'google_oauth', expiresAt },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account',
    });

    return {
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      pollingId,
    };
  }

  async handleGoogleCallback(code: string, state: string): Promise<void> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET')?.trim();
    const callbackUrl = this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim();
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new BadRequestException('Google OAuth not configured.');
    }

    const record = await this.prisma.authToken.findUnique({ where: { token: state } });
    if (!record || record.type !== 'google_oauth' || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired OAuth state.');
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenData = await tokenRes.json() as Record<string, unknown>;
    const accessToken = tokenData.access_token as string | undefined;
    if (!tokenRes.ok || !accessToken) {
      throw new UnauthorizedException('Failed to exchange Google OAuth code.');
    }

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const googleUser = await userRes.json() as {
      id?: string; email?: string; name?: string;
    };
    if (!userRes.ok || !googleUser.id || !googleUser.email) {
      throw new UnauthorizedException('Failed to fetch Google user info.');
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { googleId: googleUser.id } });
    if (!user) {
      // Try to find by email and link Google
      user = await this.prisma.user.findFirst({ where: { email: googleUser.email } });
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { googleId: googleUser.id, emailVerified: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: googleUser.email,
            googleId: googleUser.id,
            emailVerified: true,
          },
        });
      }
    }

    const { accessToken: jwt } = this.signForUser(user.id);
    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { userId: user.id, jwt },
    });
  }

  // ─── polling ─────────────────────────────────────────────────────────────

  async pollAuth(
    pollingId: string,
  ): Promise<{ status: 'pending' | 'done'; jwt?: string; userId?: string; expiresIn?: string }> {
    const record = await this.prisma.authToken.findUnique({ where: { pollingId } });
    if (!record) throw new NotFoundException('Polling session not found.');
    if (record.expiresAt < new Date()) {
      await this.prisma.authToken.delete({ where: { id: record.id } });
      throw new UnauthorizedException('Session expired. Please try again.');
    }
    if (!record.jwt || record.jwt === '__pending__') {
      return { status: 'pending' };
    }
    const userId = record.userId ?? undefined;
    const jwt = record.jwt;
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN')?.trim() ?? '7d';
    await this.prisma.authToken.delete({ where: { id: record.id } });
    return { status: 'done', jwt, userId, expiresIn };
  }

  // ─── link figma user ─────────────────────────────────────────────────────

  async linkFigma(userId: string, figmaUserId: string): Promise<void> {
    // Check if figmaUserId is already linked to another user
    const existing = await this.prisma.user.findUnique({ where: { figmaUserId } });
    if (existing && existing.id !== userId) {
      // Migrate: move jobs/subscriptions/usageCounters to the authenticated user
      // For now just re-link (the figma-only account becomes orphaned)
      await this.prisma.user.update({
        where: { id: existing.id },
        data: { figmaUserId: null },
      });
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { figmaUserId },
    });
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  signForUser(userId: string): { accessToken: string; expiresIn: string } {
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN')?.trim() ?? '7d';
    const payload: JwtPayload = { sub: userId };
    return { accessToken: this.jwt.sign(payload), expiresIn };
  }

  async refresh(userId: string): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found.');
    return this.signForUser(user.id);
  }

  // kept for legacy compatibility
  async register(dto: { email: string }): Promise<{ accessToken: string; expiresIn: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ForbiddenException('This email is already registered.');
    const user = await this.prisma.user.create({ data: { email: dto.email } });
    return this.signForUser(user.id);
  }

  async login(dto: { email: string }): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new NotFoundException('User not found.');
    return this.signForUser(user.id);
  }
}
