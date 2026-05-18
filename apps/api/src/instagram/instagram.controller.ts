import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { InstagramPreviewService } from './instagram-preview.service';
import type { PostSelectionMode, PostTimelineOrder } from '@insta2figma/shared-contracts';

type AuthedRequest = Request & { user: RequestUser };

function parseIntClamped(raw: string | undefined, fallback: number, max = 50): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseSelectionMode(raw: string | undefined): PostSelectionMode | undefined {
  const v = String(raw ?? '').trim();
  if (v === 'recent' || v === 'single' || v === 'range') return v;
  return undefined;
}

function parseTimelineOrder(raw: string | undefined): PostTimelineOrder | undefined {
  const v = String(raw ?? '').trim();
  if (v === 'newest_first' || v === 'oldest_first') return v;
  return undefined;
}

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
    @Query('selectionMode') selectionModeRaw?: string,
    @Query('startIndex') startIndexRaw?: string,
    @Query('postCount') postCountRaw?: string,
    @Query('timelineOrder') timelineOrderRaw?: string,
    @Query('previewListSize') previewListSizeRaw?: string,
  ) {
    const maxPosts = parseIntClamped(maxPostsRaw, 12);
    const expandCarouselImages =
      String(expandCarouselRaw ?? '').toLowerCase() === 'true';
    const selectionMode = parseSelectionMode(selectionModeRaw);
    const startIndex = startIndexRaw
      ? parseIntClamped(startIndexRaw, 1)
      : undefined;
    const postCount = postCountRaw
      ? parseIntClamped(postCountRaw, 1)
      : undefined;
    const timelineOrder = parseTimelineOrder(timelineOrderRaw);
    const previewListSize = previewListSizeRaw
      ? parseIntClamped(previewListSizeRaw, maxPosts)
      : undefined;

    return this.preview.getProfilePreview(String(username ?? ''), {
      maxPosts,
      expandCarouselImages,
      selectionMode,
      startIndex,
      postCount,
      timelineOrder,
      previewListSize,
    });
  }
}
