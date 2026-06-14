import type { TimelinePostItem } from '@insta2figma/shared-contracts';

function toRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Converte items do endpoint `/api/v1/feed/user/` para `TimelinePostItem[]`. */
export function parseFeedItems(itemsRaw: unknown, maxPosts = 50): TimelinePostItem[] {
  if (!Array.isArray(itemsRaw)) return [];
  const out: TimelinePostItem[] = [];

  for (const raw of itemsRaw) {
    const item = toRecord(raw);
    if (!item) continue;

    const shortcode =
      typeof item.code === 'string' && item.code.length > 0 ? item.code : null;
    if (!shortcode) continue;

    // Thumbnail: image_versions2.candidates[0].url ou display_uri
    let thumbnailUrl: string | null = null;
    const imageVersions = toRecord(item.image_versions2);
    const candidates = imageVersions?.candidates;
    if (Array.isArray(candidates)) {
      for (const c of candidates) {
        const cr = toRecord(c);
        const url = cr?.url;
        if (typeof url === 'string' && url.length > 0) {
          thumbnailUrl = url;
          break;
        }
      }
    }
    if (!thumbnailUrl && typeof item.display_uri === 'string' && item.display_uri.length > 0) {
      thumbnailUrl = item.display_uri;
    }

    // Carousel
    const carouselMedia = Array.isArray(item.carousel_media) ? item.carousel_media : [];
    const carouselImageUrls: string[] = [];
    for (const cm of carouselMedia as unknown[]) {
      const cmr = toRecord(cm);
      if (!cmr) continue;
      const cmVersions = toRecord(cmr.image_versions2);
      const cmCandidates = cmVersions?.candidates;
      if (Array.isArray(cmCandidates)) {
        for (const c of cmCandidates) {
          const cr = toRecord(c);
          const url = cr?.url;
          if (typeof url === 'string' && url.length > 0) {
            carouselImageUrls.push(url);
            break;
          }
        }
      }
    }

    const takenAtRaw = item.taken_at;
    const takenAt =
      typeof takenAtRaw === 'number' && Number.isFinite(takenAtRaw) && takenAtRaw > 0
        ? Math.floor(takenAtRaw)
        : null;
    const captionText = toRecord(item.caption)?.text;
    const caption =
      typeof captionText === 'string' && captionText.length > 0 ? captionText : null;

    const parsed: TimelinePostItem = {
      shortcode,
      thumbnailUrl,
      isVideo: item.media_type === 2,
      takenAt,
      caption,
      ...(carouselImageUrls.length > 0 ? { carouselImageUrls } : {}),
    };
    out.push(parsed);
    if (out.length >= maxPosts) break;
  }

  return out;
}
