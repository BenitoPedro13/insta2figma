import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { InstagramPreviewService } from './instagram-preview.service';

type AuthedRequest = Request & { user: RequestUser };

@Controller('instagram')
export class InstagramController {
  constructor(private readonly preview: InstagramPreviewService) {}

  @Get('profile-preview')
  @UseGuards(AuthGuard('jwt'))
  getProfilePreview(
    @Req() _req: AuthedRequest,
    @Query('username') username?: string,
  ) {
    return this.preview.getProfilePreview(String(username ?? ''));
  }
}
