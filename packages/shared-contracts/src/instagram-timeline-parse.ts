export type TimelinePostItem = {
  shortcode: string;
  thumbnailUrl: string | null;
  isVideo?: boolean;
  carouselImageUrls?: string[];
};

function asRecord(o: unknown): Record<string, unknown> | null {
  if (o !== null && typeof o === 'object' && !Array.isArray(o)) {
    return o as Record<string, unknown>;
  }
  return null;
}

function pickThumbnail(node: Record<string, unknown>): string | null {
  const d = node.display_url;
  if (typeof d === 'string' && d.length > 0) return d;
  const t = node.thumbnail_src;
  if (typeof t === 'string' && t.length > 0) return t;
  const resources = node.thumbnail_resources;
  if (Array.isArray(resources)) {
    let best: string | null = null;
    let bestW = 0;
    for (const r of resources) {
      const rec = asRecord(r);
      const src = rec?.src;
      const configW = rec?.config_width;
      if (typeof src !== 'string' || src.length === 0) continue;
      const w =
        typeof configW === 'number' && Number.isFinite(configW) ? configW : 0;
      if (w >= bestW) {
        bestW = w;
        best = src;
      }
    }
    if (best) return best;
  }
  return null;
}

function isLikelyVideo(node: Record<string, unknown>): boolean {
  const tn = node.__typename;
  if (tn === 'GraphVideo') return true;
  const vu = node.video_url;
  return typeof vu === 'string' && vu.length > 0;
}

function parseSidecarCarouselUrls(node: Record<string, unknown>): string[] {
  const esc = asRecord(node.edge_sidecar_to_children);
  if (!esc) return [];
  const edges = esc.edges;
  if (!Array.isArray(edges)) return [];
  const urls: string[] = [];
  for (const e of edges) {
    const child = asRecord(asRecord(e)?.node);
    if (!child) continue;
    const u = pickThumbnail(child);
    if (u && !urls.includes(u)) urls.push(u);
  }
  return urls;
}

/** Extrai posts da timeline IG (`edge_owner_to_timeline_media.edges`). */
export function parseTimelineSampleFromUserNode(
  userNode: unknown,
  maxPosts: number,
): TimelinePostItem[] {
  const user = asRecord(userNode);
  if (!user) return [];

  const cap = Math.min(50, Math.max(0, maxPosts));
  const timeline = asRecord(user.edge_owner_to_timeline_media);
  if (!timeline) return [];

  const edges = timeline.edges;
  if (!Array.isArray(edges)) return [];

  const out: TimelinePostItem[] = [];
  for (const e of edges) {
    const er = asRecord(e);
    const node = er ? asRecord(er.node) : null;
    if (!node) continue;
    const shortcode = node.shortcode;
    if (typeof shortcode !== 'string' || shortcode.length === 0) continue;
    const sidecar = parseSidecarCarouselUrls(node);
    const item: TimelinePostItem = {
      shortcode,
      thumbnailUrl: pickThumbnail(node),
      isVideo: isLikelyVideo(node),
    };
    if (sidecar.length > 0) {
      item.carouselImageUrls = sidecar;
    }
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

export type InstagramPostPreviewItem = {
  index: number;
  shortcode: string;
  isVideo?: boolean;
  takenAt?: string | null;
  thumbnailUrl?: string | null;
  carouselCount?: number;
};

export function buildIndexedPostPreview(
  posts: TimelinePostItem[],
  timelineOrder: 'newest_first' | 'oldest_first',
): InstagramPostPreviewItem[] {
  const ordered =
    timelineOrder === 'oldest_first' ? [...posts].reverse() : posts;
  return ordered.map((post, i) => ({
    index: i + 1,
    shortcode: post.shortcode,
    isVideo: post.isVideo,
    takenAt: null,
    thumbnailUrl: post.thumbnailUrl,
    carouselCount: post.carouselImageUrls
      ? post.carouselImageUrls.length + 1
      : 1,
  }));
}
