import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { FigmaAuthDto } from './dto/figma-auth.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
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

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<{ accessToken: string; expiresIn: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Este email já está registado.');
    }
    const user = await this.prisma.user.create({
      data: { email: dto.email },
    });
    return this.signForUser(user.id);
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; expiresIn: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) {
      throw new NotFoundException('Utilizador não encontrado. Usa /v1/auth/register primeiro.');
    }
    return this.signForUser(user.id);
  }

  async authFigma(
    dto: FigmaAuthDto,
  ): Promise<{ accessToken: string; expiresIn: string; userId: string }> {
    const figmaUserId = dto.figmaUserId.trim();
    let user = await this.prisma.user.findUnique({
      where: { figmaUserId },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          figmaUserId,
          email: figmaSyntheticEmail(figmaUserId),
        },
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

  signForUser(userId: string): {
    accessToken: string;
    expiresIn: string;
  } {
    const expiresIn =
      this.config.get<string>('JWT_EXPIRES_IN')?.trim() ?? '7d';
    const payload: JwtPayload = { sub: userId };
    const accessToken = this.jwt.sign(payload);
    return {
      accessToken,
      expiresIn,
    };
  }
}
