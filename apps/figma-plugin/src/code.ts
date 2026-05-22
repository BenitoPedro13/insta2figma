import { JOB_TYPES } from '@insta2figma/shared-contracts';

function assertWorkspaceContractsLinked(): void {
  if (JOB_TYPES.length !== 2) {
    throw new Error('@insta2figma/shared-contracts inconsistente');
  }
}

assertWorkspaceContractsLinked();

function formatCaught(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

const UI_SIZE_STORAGE_KEY = 'insta2figma:ui-size:v1';
const UI_SIZE_DEFAULT = { width: 872, height: 667 };
const UI_SIZE_MIN = { width: 380, height: 420 };
const UI_SIZE_MAX = { width: 1200, height: 900 };

function clampUiSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.min(
      UI_SIZE_MAX.width,
      Math.max(UI_SIZE_MIN.width, Math.round(width)),
    ),
    height: Math.min(
      UI_SIZE_MAX.height,
      Math.max(UI_SIZE_MIN.height, Math.round(height)),
    ),
  };
}

figma.showUI(__html__, {
  width: UI_SIZE_DEFAULT.width,
  height: UI_SIZE_DEFAULT.height,
  themeColors: true,
});

void (async () => {
  try {
    const raw = await figma.clientStorage.getAsync(UI_SIZE_STORAGE_KEY);
    if (
      raw &&
      typeof raw === 'object' &&
      'width' in raw &&
      'height' in raw &&
      typeof (raw as { width: unknown }).width === 'number' &&
      typeof (raw as { height: unknown }).height === 'number'
    ) {
      const size = clampUiSize(
        (raw as { width: number }).width,
        (raw as { height: number }).height,
      );
      figma.ui.resize(size.width, size.height);
    }
  } catch (e) {
    console.warn('[Insta2Figma] ui-size load', e);
  }
})();

void bootstrapSession();

/** Alinhado com `historyStorage.ts` HISTORY_STORAGE_KEY — persistência via `clientStorage`. */
const HISTORY_STORAGE_KEY = 'insta2figma:history:v1';
const SESSION_STORAGE_KEY = 'insta2figma:session:v1';
const DEFAULT_API_BASE = 'http://127.0.0.1:3333';

type StoredSession = {
  accessToken: string;
  userId: string;
  figmaUserId: string;
};

type SessionQuotas = {
  jobsRemaining: number | null;
  jobsLimit: number | null;
  maxPosts: number;
  expandCarouselImages: boolean;
};

type SessionPayload = {
  planTier: 'free' | 'pro';
  quotas: SessionQuotas;
  userId: string;
};

const SAMPLE_JPEG_URL =
  'https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546';

async function loadSampleImage(): Promise<Image> {
  const res = await fetch(SAMPLE_JPEG_URL);
  if (!res.ok) {
    throw new Error(`Download da imagem falhou (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return figma.createImage(bytes);
}

async function loadSampleImageOrNull(): Promise<Image | null> {
  try {
    return await loadSampleImage();
  } catch (e) {
    console.warn('[Insta2Figma] Fallback sem imagem de exemplo:', e);
    return null;
  }
}

async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Headers alinhados ao worker — CDN do IG costuma exigir `Referer` válido no main thread. */
const IG_AVATAR_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  Referer: 'https://www.instagram.com/',
};

const MAX_PROFILE_PIC_FETCH_BYTES = 850_000;

async function fetchInstagramCdnAsDataUrl(
  cdnUrl: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const res = (await fetch(cdnUrl.trim(), {
      method: 'GET',
      redirect: 'follow',
      headers: IG_AVATAR_FETCH_HEADERS,
    })) as unknown as {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
      headers?: { get?: (name: string) => string | null };
    };
    if (!res.ok) return undefined;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) {
      return undefined;
    }
    let ct = res.headers?.get?.('content-type')?.split(';')[0]?.trim() ?? '';
    if (!ct.startsWith('image/')) ct = 'image/jpeg';
    const b64 = bytesToBase64(buf);
    if (!b64) return undefined;
    return `data:${ct};base64,${b64}`;
  } catch (e) {
    console.warn('[Insta2Figma] falha ao inline CDN IG', e);
    return undefined;
  }
}

/** Na UI, `<img src="https://fbcdn…">` falha com frequência; fazemos fetch no main + data URL. */
async function fetchInstagramAvatarAsDataUrl(
  cdnUrl: string,
): Promise<string | undefined> {
  return fetchInstagramCdnAsDataUrl(cdnUrl, MAX_PROFILE_PIC_FETCH_BYTES);
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  while (i + 2 < bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    out += alphabet[(n >> 6) & 63];
    out += alphabet[n & 63];
    i += 3;
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    out += '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    out += alphabet[(n >> 6) & 63];
    out += '=';
  }
  return out;
}

function pickProfilePicUrlFromJobResultSummary(resultSummary: unknown): string | undefined {
  if (
    resultSummary === null ||
    typeof resultSummary !== 'object' ||
    Array.isArray(resultSummary)
  ) {
    return undefined;
  }
  const profile = (resultSummary as Record<string, unknown>).profile;
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return undefined;
  }
  const pr = profile as Record<string, unknown>;
  const hd = pr.profilePicUrlHd;
  if (typeof hd === 'string' && hd.trim().length > 0) return hd.trim();
  const fallback = pr.profilePicUrl;
  return typeof fallback === 'string' && fallback.trim().length > 0
    ? fallback.trim()
    : undefined;
}

/** Coloca imagens em grelha (URLs presign MinIO/S3). `profilePicUrl`: CDN ou `data:` para o histórico (não vai para o canvas). */
async function placeSignedImages(
  urls: string[],
  opts?: { profilePicUrl?: string },
): Promise<void> {
  const size = 280;
  const gap = 16;
  const maxRowWidth = 1400;
  let x = 0;
  let y = 0;
  let rowH = 0;
  const nodes: SceneNode[] = [];
  let ok = 0;

  for (const url of urls) {
    try {
      const bytes = await fetchImageBytes(url);
      const image = figma.createImage(bytes);
      const rect = figma.createRectangle();
      rect.resize(size, size);
      rect.fills = [
        { type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash },
      ];
      if (x + size > maxRowWidth && x > 0) {
        x = 0;
        y += rowH + gap;
        rowH = 0;
      }
      rect.x = x;
      rect.y = y;
      x += size + gap;
      rowH = Math.max(rowH, size);
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
      ok += 1;
    } catch (e) {
      console.warn('[Insta2Figma] skip URL', url.slice(0, 80), e);
    }
  }

  if (nodes.length === 0) {
    figma.notify('Nenhuma imagem foi colocada (falhas de download).', {
      error: true,
    });
    figma.ui.postMessage({
      type: 'import-done',
      placed: 0,
      total: urls.length,
      error: true,
    });
    return;
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  figma.notify(`Insta2Figma: ${ok} imagem(ns) no canvas.`);
  figma.ui.postMessage({
    type: 'import-done',
    placed: ok,
    total: urls.length,
    error: false,
    ...(opts?.profilePicUrl ? { profilePicUrl: opts.profilePicUrl } : {}),
  });
}

type PluginMessage =
  | { type: 'cancel' }
  | { type: 'ui-resize'; width: number; height: number; persist?: boolean }
  | { type: 'history-request' }
  /** Guardado em `figma.clientStorage` (persiste entre sessões; o `localStorage` do iframe não). */
  | { type: 'history-save'; entries: unknown }
  | {
      type: 'profile-preview';
      requestId: number;
      username: string;
      maxPosts?: number;
      expandCarouselImages?: boolean;
      selectionMode?: 'recent' | 'single' | 'range';
      startIndex?: number;
      postCount?: number;
      timelineOrder?: 'newest_first' | 'oldest_first';
      previewListSize?: number;
    }
  | { type: 'create-shapes'; count: number }
  | { type: 'place-images'; urls: string[] }
  | {
      type: 'import-profile';
      username: string;
      maxPosts?: number;
      expandCarouselImages?: boolean;
      selectionMode?: 'recent' | 'single' | 'range';
      startIndex?: number;
      postCount?: number;
      timelineOrder?: 'newest_first' | 'oldest_first';
    }
  | { type: 'session-request' }
  | { type: 'billing-checkout' }
  | { type: 'billing-portal' }
  | { type: 'error'; message: unknown };

function normBase(b: string): string {
  return String(b ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function parseApiError(payload: Record<string, unknown>): string {
  const err = payload.error as { code?: string; message?: string } | undefined;
  if (err?.message) return err.message;
  return JSON.stringify(payload).slice(0, 240);
}

async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = await figma.clientStorage.getAsync(SESSION_STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as StoredSession;
    if (
      typeof s.accessToken === 'string' &&
      typeof s.userId === 'string' &&
      typeof s.figmaUserId === 'string'
    ) {
      return s;
    }
  } catch (e) {
    console.warn('[Insta2Figma] loadStoredSession', e);
  }
  return null;
}

async function saveStoredSession(session: StoredSession): Promise<void> {
  await figma.clientStorage.setAsync(SESSION_STORAGE_KEY, session);
}

async function authFigmaUser(
  base: string,
  figmaUserId: string,
  name?: string,
): Promise<StoredSession> {
  const res = await fetch(`${base}/v1/auth/figma`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ figmaUserId, name }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as
    | { accessToken?: string; userId?: string }
    | undefined;
  if (!res.ok || !data?.accessToken || !data?.userId) {
    throw new Error(`Auth Figma ${res.status}: ${parseApiError(payload)}`);
  }
  const session: StoredSession = {
    accessToken: data.accessToken,
    userId: data.userId,
    figmaUserId,
  };
  await saveStoredSession(session);
  return session;
}

async function fetchMe(base: string, token: string): Promise<SessionPayload> {
  const res = await fetch(`${base}/v1/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!res.ok || !data) {
    throw new Error(`GET /me ${res.status}: ${parseApiError(payload)}`);
  }
  const quotasRaw = data.quotas as Record<string, unknown> | undefined;
  const planTier = data.planTier === 'pro' ? 'pro' : 'free';
  return {
    planTier,
    userId: String(data.userId ?? ''),
    quotas: {
      jobsRemaining:
        typeof quotasRaw?.jobsRemaining === 'number'
          ? quotasRaw.jobsRemaining
          : quotasRaw?.jobsRemaining === null
            ? null
            : 0,
      jobsLimit:
        typeof quotasRaw?.jobsLimit === 'number'
          ? quotasRaw.jobsLimit
          : quotasRaw?.jobsLimit === null
            ? null
            : null,
      maxPosts:
        typeof quotasRaw?.maxPosts === 'number' && Number.isFinite(quotasRaw.maxPosts)
          ? quotasRaw.maxPosts
          : 12,
      expandCarouselImages: quotasRaw?.expandCarouselImages === true,
    },
  };
}

async function ensureSession(base: string): Promise<{
  session: StoredSession;
  me: SessionPayload;
}> {
  const figmaUser = figma.currentUser;
  if (!figmaUser?.id) {
    throw new Error('Inicia sessão no Figma para usar o Insta2Figma.');
  }
  const figmaUserId = figmaUser.id;
  let stored = await loadStoredSession();
  if (!stored || stored.figmaUserId !== figmaUserId) {
    stored = await authFigmaUser(
      base,
      figmaUserId,
      figmaUser.name ?? undefined,
    );
  }
  const me = await fetchMe(base, stored.accessToken);
  return { session: stored, me };
}

async function bootstrapSession(): Promise<void> {
  const base = normBase(DEFAULT_API_BASE);
  try {
    const { me } = await ensureSession(base);
    figma.ui.postMessage({ type: 'session-data', ...me });
  } catch (err) {
    figma.ui.postMessage({
      type: 'session-error',
      message: formatCaught(err),
    });
  }
}

async function openBillingCheckout(base: string, token: string): Promise<void> {
  const res = await fetch(`${base}/v1/billing/checkout-session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as { url?: string } | undefined;
  if (!res.ok || !data?.url) {
    throw new Error(`Checkout ${res.status}: ${parseApiError(payload)}`);
  }
  figma.openExternal(data.url);
}

async function openBillingPortal(base: string, token: string): Promise<void> {
  const res = await fetch(`${base}/v1/billing/portal-session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as { url?: string } | undefined;
  if (!res.ok || !data?.url) {
    throw new Error(`Portal ${res.status}: ${parseApiError(payload)}`);
  }
  figma.openExternal(data.url);
}

async function importProfileViaApi(
  base: string,
  username: string,
  options: {
    maxPosts: number;
    expandCarouselImages: boolean;
    selectionMode?: 'recent' | 'single' | 'range';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
  },
): Promise<void> {
  const notifyStatus = (text: string) => {
    figma.ui.postMessage({ type: 'import-status', text });
  };

  notifyStatus('A autenticar…');
  const { session, me } = await ensureSession(base);
  const token = session.accessToken;
  figma.ui.postMessage({ type: 'session-data', ...me });

  notifyStatus(
    `A criar job (${options.selectionMode ?? 'recent'} · carrossel: ${options.expandCarouselImages ? 'todas as imagens' : 'só capa'})…`,
  );
  const idem = `figma-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const jr = await fetch(`${base}/v1/jobs`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idem,
    },
    body: JSON.stringify({
      type: 'SCRAPE_PROFILE',
      input: {
        username,
        maxPosts: options.maxPosts,
        expandCarouselImages: options.expandCarouselImages,
        ...(options.selectionMode ? { selectionMode: options.selectionMode } : {}),
        ...(options.startIndex != null ? { startIndex: options.startIndex } : {}),
        ...(options.postCount != null ? { postCount: options.postCount } : {}),
        ...(options.timelineOrder ? { timelineOrder: options.timelineOrder } : {}),
      },
    }),
  });
  const jobBody = (await jr.json().catch(() => ({}))) as Record<string, unknown>;
  const data = jobBody.data as { id?: string } | undefined;
  const legacyId = typeof jobBody.id === 'string' ? jobBody.id : undefined;
  if (!jr.ok) {
    const err = jobBody.error as { code?: string; message?: string } | undefined;
    if (err?.code === 'QUOTA_EXCEEDED') {
      throw new Error(
        err.message ??
          'Quota mensal esgotada. Faz upgrade para Pro para continuar.',
      );
    }
    throw new Error(`${jr.status}: ${parseApiError(jobBody)}`);
  }
  const jobId = data?.id ?? legacyId;
  if (!jobId) {
    throw new Error('Sem id no job.');
  }

  notifyStatus(`Job ${jobId} — a aguardar…`);
  let lastResultSummary: unknown = undefined;
  let status = '';
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const gr = await fetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const gj = (await gr.json().catch(() => ({}))) as Record<string, unknown>;
    const gData = gj.data as Record<string, unknown> | undefined;
    if (!gr.ok) {
      throw new Error(`GET job ${gr.status}`);
    }
    status = String(gData?.status ?? gj.status ?? '');
    notifyStatus(`${status} (${i})`);
    if (status === 'succeeded') {
      lastResultSummary = gData?.resultSummary;
      const rs = lastResultSummary;
      if (rs !== null && typeof rs === 'object' && !Array.isArray(rs)) {
        const sm = (rs as Record<string, unknown>).scrapingMeta;
        if (sm !== null && typeof sm === 'object' && !Array.isArray(sm)) {
          const smb = sm as Record<string, unknown>;
          const req = smb.requestedMaxPosts;
          const sample = smb.postsInSample;
          const expanded = smb.expandCarouselImages === true;
          if (typeof req === 'number' && typeof sample === 'number') {
            notifyStatus(
              `Job OK — pedido ${req} posts, carrossel ${expanded ? 'expandido' : 'só capa'}, amostra com ${sample} post(s).`,
            );
          }
        }
      }
      break;
    }
    if (status === 'failed') {
      const err = String(gData?.errorCode ?? '').trim();
      const msgErr = String(gData?.errorMessage ?? '').trim();
      throw new Error(`Job falhou: ${err} ${msgErr}`);
    }
  }
  if (status !== 'succeeded') {
    throw new Error('Timeout a aguardar job.');
  }

  notifyStatus('A obter URLs assinadas…');
  const sr = await fetch(
    `${base}/v1/jobs/${encodeURIComponent(jobId)}?include=signedAssets`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const sj = (await sr.json().catch(() => ({}))) as Record<string, unknown>;
  const sData = sj.data as
    | { signedAssets?: { url?: string; storageKey?: string }[] }
    | undefined;
  if (!sr.ok) {
    throw new Error(`${sr.status}: ${JSON.stringify(sj)}`);
  }
  const fromData = sData?.signedAssets;
  const fromRoot = sj.signedAssets as
    | { url?: string; storageKey?: string }[]
    | undefined;
  const list = Array.isArray(fromData)
    ? fromData
    : Array.isArray(fromRoot)
      ? fromRoot
      : [];
  const profileAsset = list.find((a) =>
    typeof a?.storageKey === 'string'
      ? /\/profile\.[a-z0-9]+$/i.test(String(a.storageKey))
      : false,
  );
  const profileUrlFromSignedAssets =
    typeof profileAsset?.url === 'string' && profileAsset.url.trim() !== ''
      ? profileAsset.url.trim()
      : undefined;
  const urls = list
    .filter((a) =>
      typeof a?.storageKey === 'string'
        ? !/\/profile\.[a-z0-9]+$/i.test(String(a.storageKey))
        : true,
    )
    .map((a) => (a?.url ? String(a.url) : ''))
    .filter(Boolean);

  if (urls.length === 0) {
    throw new Error('Nenhuma imagem guardada — verifica MinIO/worker.');
  }

  notifyStatus(`A colocar ${urls.length} imagem(ns) no canvas…`);
  const rawProfilePic = pickProfilePicUrlFromJobResultSummary(lastResultSummary);
  let profilePicForHistory: string | undefined;
  if (profileUrlFromSignedAssets) {
    profilePicForHistory = profileUrlFromSignedAssets;
  } else if (rawProfilePic) {
    notifyStatus('A sincronizar foto do perfil…');
    profilePicForHistory =
      (await fetchInstagramAvatarAsDataUrl(rawProfilePic)) ?? rawProfilePic;
  }
  await placeSignedImages(urls, {
    ...(profilePicForHistory ? { profilePicUrl: profilePicForHistory } : {}),
  });
}

function buildPreviewQueryString(
  username: string,
  opts: {
    maxPosts: number;
    expandCarouselImages: boolean;
    selectionMode?: 'recent' | 'single' | 'range';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
    previewListSize?: number;
  },
): string {
  const parts = [
    `username=${encodeURIComponent(username)}`,
    `maxPosts=${encodeURIComponent(String(opts.maxPosts))}`,
    `expandCarouselImages=${opts.expandCarouselImages ? 'true' : 'false'}`,
  ];
  if (opts.selectionMode) {
    parts.push(`selectionMode=${encodeURIComponent(opts.selectionMode)}`);
  }
  if (opts.startIndex != null) {
    parts.push(`startIndex=${encodeURIComponent(String(opts.startIndex))}`);
  }
  if (opts.postCount != null) {
    parts.push(`postCount=${encodeURIComponent(String(opts.postCount))}`);
  }
  if (opts.timelineOrder) {
    parts.push(`timelineOrder=${encodeURIComponent(opts.timelineOrder)}`);
  }
  if (opts.previewListSize != null) {
    parts.push(`previewListSize=${encodeURIComponent(String(opts.previewListSize))}`);
  }
  return parts.join('&');
}

async function previewProfileViaApi(
  base: string,
  username: string,
  opts: {
    maxPosts: number;
    expandCarouselImages: boolean;
    selectionMode?: 'recent' | 'single' | 'range';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
    previewListSize?: number;
  },
): Promise<{
  username: string;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  estimatedImportImages: number;
  estimatedPostCovers: number;
  estimatedCarouselExtras: number;
  postsPreview?: {
    index: number;
    shortcode: string;
    isVideo?: boolean;
    thumbnailUrl?: string | null;
    carouselCount?: number;
  }[];
  postsAvailable?: number;
  selectionWarning?: string;
}> {
  const { session } = await ensureSession(base);
  const token = session.accessToken;
  const qs = buildPreviewQueryString(username, opts);
  const res = await fetch(`${base}/v1/instagram/profile-preview?${qs}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!res.ok || !data) {
    throw new Error(
      `Preview ${res.status}: ${JSON.stringify(payload.error ?? payload).slice(0, 240)}`,
    );
  }
  return {
    username: String(data.username ?? username),
    profilePicUrlHd:
      typeof data.profilePicUrlHd === 'string' ? data.profilePicUrlHd : null,
    profilePicDataUrl:
      typeof data.profilePicDataUrl === 'string' ? data.profilePicDataUrl : null,
    mediaCount:
      typeof data.mediaCount === 'number' && Number.isFinite(data.mediaCount)
        ? data.mediaCount
        : 0,
    isPrivate: data.isPrivate === true,
    estimatedImportImages:
      typeof data.estimatedImportImages === 'number' &&
      Number.isFinite(data.estimatedImportImages)
        ? data.estimatedImportImages
        : 0,
    estimatedPostCovers:
      typeof data.estimatedPostCovers === 'number' &&
      Number.isFinite(data.estimatedPostCovers)
        ? data.estimatedPostCovers
        : 0,
    estimatedCarouselExtras:
      typeof data.estimatedCarouselExtras === 'number' &&
      Number.isFinite(data.estimatedCarouselExtras)
        ? data.estimatedCarouselExtras
        : 0,
    postsPreview: Array.isArray(data.postsPreview)
      ? (data.postsPreview as {
          index: number;
          shortcode: string;
          isVideo?: boolean;
          thumbnailUrl?: string | null;
          carouselCount?: number;
        }[])
      : undefined,
    postsAvailable:
      typeof data.postsAvailable === 'number' && Number.isFinite(data.postsAvailable)
        ? data.postsAvailable
        : undefined,
    selectionWarning:
      typeof data.selectionWarning === 'string' ? data.selectionWarning : undefined,
  };
}

figma.ui.onmessage = async (msg: PluginMessage) => {
  if (msg.type === 'ui-resize') {
    const size = clampUiSize(msg.width, msg.height);
    figma.ui.resize(size.width, size.height);
    if (msg.persist) {
      try {
        await figma.clientStorage.setAsync(UI_SIZE_STORAGE_KEY, size);
      } catch (e) {
        console.warn('[Insta2Figma] ui-size save', e);
      }
    }
    return;
  }

  if (msg.type === 'session-request') {
    await bootstrapSession();
    return;
  }

  if (msg.type === 'billing-checkout') {
    const base = normBase(DEFAULT_API_BASE);
    try {
      const { session } = await ensureSession(base);
      await openBillingCheckout(base, session.accessToken);
      figma.notify('Checkout aberto no browser.');
    } catch (err) {
      figma.notify(`Insta2Figma: ${formatCaught(err)}`, { error: true });
    }
    return;
  }

  if (msg.type === 'billing-portal') {
    const base = normBase(DEFAULT_API_BASE);
    try {
      const { session } = await ensureSession(base);
      await openBillingPortal(base, session.accessToken);
      figma.notify('Portal de cliente aberto no browser.');
    } catch (err) {
      figma.notify(`Insta2Figma: ${formatCaught(err)}`, { error: true });
    }
    return;
  }

  if (msg.type === 'history-request') {
    try {
      const raw = await figma.clientStorage.getAsync(HISTORY_STORAGE_KEY);
      let entries: unknown = [];
      if (Array.isArray(raw)) {
        entries = raw;
      } else if (typeof raw === 'string') {
        try {
          entries = JSON.parse(raw) as unknown;
        } catch {
          entries = [];
        }
      }
      figma.ui.postMessage({ type: 'history-data', entries });
    } catch (e) {
      console.warn('[Insta2Figma] history-request', e);
      figma.ui.postMessage({ type: 'history-data', entries: [] });
    }
    return;
  }

  if (msg.type === 'history-save') {
    try {
      const arr = Array.isArray(msg.entries) ? msg.entries : [];
      await figma.clientStorage.setAsync(HISTORY_STORAGE_KEY, arr);
    } catch (e) {
      console.error('[Insta2Figma] history-save', e);
    }
    return;
  }

  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'error') {
    figma.notify(`Insta2Figma: ${formatCaught(msg.message)}`, { error: true });
    return;
  }

  if (msg.type === 'import-profile') {
    const base = normBase(DEFAULT_API_BASE);
    const username = String(msg.username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const maxPostsRaw = msg.maxPosts ?? 8;
    const maxPosts = Math.min(
      50,
      Math.max(
        1,
        Number.isFinite(Number(maxPostsRaw))
          ? Math.floor(Number(maxPostsRaw))
          : 8,
      ),
    );
    const expandCarouselImages = msg.expandCarouselImages === true;
    if (!username) {
      figma.notify('Insta2Figma: Preenche username.', {
        error: true,
      });
      figma.ui.postMessage({
        type: 'import-error',
        message: 'Preenche username.',
      });
      return;
    }
    try {
      await importProfileViaApi(base, username, {
        maxPosts,
        expandCarouselImages,
        selectionMode: msg.selectionMode,
        startIndex: msg.startIndex,
        postCount: msg.postCount,
        timelineOrder: msg.timelineOrder,
      });
    } catch (err) {
      const text = formatCaught(err);
      console.error('[Insta2Figma] import-profile', err);
      figma.notify(`Insta2Figma: ${text}`, { error: true });
      figma.ui.postMessage({ type: 'import-error', message: text });
    }
    return;
  }

  if (msg.type === 'profile-preview') {
    const base = normBase(DEFAULT_API_BASE);
    const username = String(msg.username ?? '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
    const maxPostsRaw = msg.maxPosts ?? 12;
    const maxPosts = Math.min(
      50,
      Math.max(
        1,
        Number.isFinite(Number(maxPostsRaw))
          ? Math.floor(Number(maxPostsRaw))
          : 12,
      ),
    );
    const expandCarouselImages = msg.expandCarouselImages === true;
    if (!username) {
      figma.ui.postMessage({
        type: 'profile-preview-error',
        requestId: msg.requestId,
        message: 'Preenche username.',
      });
      return;
    }
    try {
      const preview = await previewProfileViaApi(base, username, {
        maxPosts,
        expandCarouselImages,
        selectionMode: msg.selectionMode,
        startIndex: msg.startIndex,
        postCount: msg.postCount,
        timelineOrder: msg.timelineOrder,
        previewListSize: msg.previewListSize,
      });
      const postsWithThumbs = preview.postsPreview ?? [];
      const postsMeta = postsWithThumbs.map((item) => ({
        index: item.index,
        shortcode: item.shortcode,
        isVideo: item.isVideo,
        carouselCount: item.carouselCount,
        thumbnailUrl: null as string | null,
      }));
      figma.ui.postMessage({
        type: 'profile-preview-data',
        requestId: msg.requestId,
        username: preview.username,
        mediaCount: preview.mediaCount,
        isPrivate: preview.isPrivate,
        estimatedImportImages: preview.estimatedImportImages,
        estimatedPostCovers: preview.estimatedPostCovers,
        estimatedCarouselExtras: preview.estimatedCarouselExtras,
        postsPreview: postsMeta,
        postsAvailable: preview.postsAvailable,
        selectionWarning: preview.selectionWarning,
        thumbsPending: postsWithThumbs.length,
        ...(preview.profilePicDataUrl
          ? { profilePicUrlHd: preview.profilePicDataUrl }
          : {}),
      });
      for (const item of postsWithThumbs) {
        const url = item.thumbnailUrl;
        if (typeof url === 'string' && url.startsWith('data:') && url.length > 0) {
          figma.ui.postMessage({
            type: 'profile-preview-thumb',
            requestId: msg.requestId,
            shortcode: item.shortcode,
            thumbnailUrl: url,
          });
        }
      }
      if (postsWithThumbs.length > 0) {
        figma.ui.postMessage({
          type: 'profile-preview-thumbs-done',
          requestId: msg.requestId,
        });
      }
    } catch (err) {
      figma.ui.postMessage({
        type: 'profile-preview-error',
        requestId: msg.requestId,
        message: formatCaught(err),
      });
    }
    return;
  }

  if (msg.type === 'place-images') {
    if (!Array.isArray(msg.urls) || msg.urls.length === 0) {
      figma.notify('Lista de URLs vazia.', { error: true });
      return;
    }
    try {
      await placeSignedImages(msg.urls);
    } catch (err) {
      const text = formatCaught(err);
      figma.notify(text, { error: true });
      figma.ui.postMessage({ type: 'import-done', placed: 0, total: 0, error: true });
      console.error('[Insta2Figma]', err);
    }
    return;
  }

  if (msg.type !== 'create-shapes') {
    return;
  }

  if (
    typeof msg.count !== 'number' ||
    !Number.isInteger(msg.count) ||
    msg.count <= 0
  ) {
    figma.notify('Indica um número inteiro positivo.', { error: true });
    return;
  }

  try {
    const image = await loadSampleImageOrNull();
    if (!image) {
      figma.notify(
        'Não foi possível carregar a imagem de exemplo (CDN). A criar rectângulos sólidos.',
      );
    }
    const nodes: SceneNode[] = [];
    const fill: RectangleNode['fills'] =
      image != null
        ? [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }]
        : [{ type: 'SOLID', color: { r: 0.2, g: 0.5, b: 0.95 } }];
    for (let i = 0; i < msg.count; i++) {
      const rect = figma.createRectangle();
      rect.x = i * 150;
      rect.fills = fill;
      figma.currentPage.appendChild(rect);
      nodes.push(rect);
    }
    figma.currentPage.selection = nodes;
    figma.viewport.scrollAndZoomIntoView(nodes);
    figma.closePlugin();
  } catch (err) {
    const text = formatCaught(err);
    figma.notify(`Insta2Figma: ${text}`, { error: true });
    console.error('[Insta2Figma]', err);
  }
};
