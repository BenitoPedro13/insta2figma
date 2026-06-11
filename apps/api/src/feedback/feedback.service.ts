import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../auth/email.service';
import type { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async create(dto: CreateFeedbackDto, userId?: string): Promise<{ id: string }> {
    const feedback = await this.prisma.feedback.create({
      data: {
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        message: dto.message.trim(),
        platform: dto.platform ?? null,
        userId: userId ?? null,
      },
    });

    // Email é best-effort — o feedback já está persistido na tabela
    try {
      await this.email.sendFeedback({
        name: feedback.name,
        email: feedback.email,
        message: feedback.message,
        platform: feedback.platform,
      });
    } catch (e) {
      console.warn('[feedback] envio de email falhou (registo guardado)', e);
    }

    return { id: feedback.id };
  }
}
