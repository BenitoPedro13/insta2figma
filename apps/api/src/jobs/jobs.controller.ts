import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { JobsService } from './jobs.service';

type AuthedRequest = Request & { user: RequestUser };

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  /** Body validado com Zod (`@insta2figma/shared-contracts`). */
  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.jobs.create(req.user.userId, body, idempotencyKey);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  getOne(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getOne(req.user.userId, id);
  }
}
