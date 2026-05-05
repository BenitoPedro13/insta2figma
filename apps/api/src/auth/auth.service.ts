import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './auth-token.payload';

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

  private signForUser(userId: string): {
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
