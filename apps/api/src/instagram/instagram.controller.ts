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
    @Query('maxPosts') maxPostsRaw?: string,
    @Query('expandCarouselImages') expandCarouselRaw?: string,
  ) {
    const parsedPosts = Number.parseInt(String(maxPostsRaw ?? ''), 10);
    const maxPosts = Number.isFinite(parsedPosts)
      ? Math.min(50, Math.max(1, parsedPosts))
      : 12;
    const expandCarouselImages =
      String(expandCarouselRaw ?? '').toLowerCase() === 'true';
    return this.preview.getProfilePreview(String(username ?? ''), {
      maxPosts,
      expandCarouselImages,
    });
  }
}
