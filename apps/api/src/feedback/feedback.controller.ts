import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import type { RequestUser } from '../auth/jwt.strategy';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

type MaybeAuthedRequest = Request & { user?: RequestUser };

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  create(@Req() req: MaybeAuthedRequest, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(dto, req.user?.userId);
  }
}
