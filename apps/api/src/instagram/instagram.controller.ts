import { BadRequestException, Controller, Get, Query, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestUser } from '../auth/jwt.strategy';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { PlanService } from '../plan/plan.service';
import { InstagramPreviewService } from './instagram-preview.service';
import { IG_IMAGE_HEADERS } from '@insta2figma/shared-instagram';

const ALLOWED_CDN_HOSTS = ['cdninstagram.com', 'fbcdn.net'];

function isInstagramCdnUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED_CDN_HOSTS.some((h) => u.hostname.endsWith(h));
  } catch {
    return false;
  }
}
import type { PostSelectionMode, PostTimelineOrder } from '@insta2figma/shared-contracts';

type MaybeAuthedRequest = Request & { user?: RequestUser | null };

function parseIntClamped(raw: string | undefined, fallback: number, max = 50): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseSelectionMode(raw: string | undefined): PostSelectionMode | undefined {
  const v = String(raw ?? '').trim();
  if (v === 'recent' || v === 'single' || v === 'range' || v === 'multi') return v;
  return undefined;
}

function parseSelectedIndices(raw: string | undefined): number[] | undefined {
  const text = String(raw ?? '').trim();
  if (!text) return undefined;
  const parts = text.split(',').map((part) => Number.parseInt(part.trim(), 10));
  const out = parts.filter((n) => Number.isFinite(n) && n >= 1 && n <= 50);
  return out.length > 0 ? out : undefined;
}

function parseTimelineOrder(raw: string | undefined): PostTimelineOrder | undefined {
  const v = String(raw ?? '').trim();
  if (v === 'newest_first' || v === 'oldest_first') return v;
  return undefined;
}

@Controller('instagram')
export class InstagramController {
  constructor(
    private readonly preview: InstagramPreviewService,
    private readonly plan: PlanService,
  ) {}

  @Get('image')
  async proxyImage(
    @Query('url') rawUrl: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const url = decodeURIComponent(rawUrl ?? '').trim();
    if (!url || !isInstagramCdnUrl(url)) {
      throw new BadRequestException('URL inválido — apenas Instagram CDN permitido.');
    }

    let imageRes: globalThis.Response;
    try {
      imageRes = await fetch(url, { headers: IG_IMAGE_HEADERS, redirect: 'follow' });
    } catch {
      throw new ServiceUnavailableException('Falha ao obter imagem do Instagram CDN.');
    }

    if (!imageRes.ok) {
      res.status(imageRes.status).end();
      return;
    }

    const ct = imageRes.headers.get('content-type') ?? 'image/jpeg';
    const buf = Buffer.from(await imageRes.arrayBuffer());

    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    res.setHeader('Content-Length', buf.byteLength);
    res.status(200).send(buf);
  }

  @Get('profile-preview')
  @UseGuards(OptionalJwtAuthGuard)
  async getProfilePreview(
    @Req() req: MaybeAuthedRequest,
    @Query('username') username?: string,
    @Query('maxPosts') maxPostsRaw?: string,
    @Query('expandCarouselImages') expandCarouselRaw?: string,
    @Query('selectionMode') selectionModeRaw?: string,
    @Query('startIndex') startIndexRaw?: string,
    @Query('postCount') postCountRaw?: string,
    @Query('timelineOrder') timelineOrderRaw?: string,
    @Query('previewListSize') previewListSizeRaw?: string,
    @Query('selectedIndices') selectedIndicesRaw?: string,
    @Query('previewPage') previewPageRaw?: string,
    @Query('after') after?: string,
    @Query('userId') userId?: string,
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
    const selectedIndices = parseSelectedIndices(selectedIndicesRaw);
    const previewPage = parseIntClamped(previewPageRaw, 1, 999);
    const callerUserId = req.user?.userId ?? null;
    const planTier = callerUserId
      ? await this.plan.getPlanTierForUser(callerUserId)
      : 'free';

    return this.preview.getProfilePreview(String(username ?? ''), {
      maxPosts,
      expandCarouselImages,
      selectionMode,
      startIndex,
      postCount,
      timelineOrder,
      previewListSize,
      selectedIndices,
      previewPage,
      after,
      userId,
      planTier,
      callerUserId: callerUserId ?? undefined,
    });
  }
}
