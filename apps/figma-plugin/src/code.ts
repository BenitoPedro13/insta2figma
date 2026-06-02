import { JOB_TYPES, parseInstagramUsername } from '@insta2figma/shared-contracts';
import {
  importStatusAuth,
  importStatusAvatar,
  importStatusPlacing,
  importStatusPostsFound,
  importStatusQueue,
  importStatusSigning,
  importStatusWaiting,
} from './importStatusCopy';
import { resolveApiBase } from './api-base';
import { apiFetch, probeApiHealth } from './plugin-fetch';

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
const UI_SIZE_MIN = { width: 830, height: 420 };
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
const API_BASE_STORAGE_KEY = 'insta2figma:api-base:v1';

/** Local se `pnpm dev` responder em /v1/health; senão Railway (ver `api-base.ts`). */
async function getApiBase(): Promise<string> {
  const base = await resolveApiBase();
  try {
    const prev = await figma.clientStorage.getAsync(API_BASE_STORAGE_KEY);
    if (typeof prev === 'string' && prev !== base) {
      await figma.clientStorage.deleteAsync(SESSION_STORAGE_KEY);
    }
    await figma.clientStorage.setAsync(API_BASE_STORAGE_KEY, base);
  } catch (e) {
    console.warn('[Insta2Figma] api-base persist', e);
  }
  return base;
}

type StoredSession = {
  accessToken: string;
  userId: string;
  figmaUserId: string;
};

type SessionQuotas = {
  imagesRemaining: number | null;
  imagesLimit: number | null;
  maxPosts: number;
  maxImagesPerJob: number;
  expandCarouselImages: boolean;
  periodEnd: string | null;
};

type SessionPayload = {
  planTier: 'free' | 'pro' | 'max';
  quotas: SessionQuotas;
  userId: string;
  subscription?: { currentPeriodEnd: string | null };
};

const SAMPLE_JPEG_URL =
  'https://instagram.fsdu12-1.fna.fbcdn.net/v/t51.2885-15/279910414_168521058871473_7937661385851861231_n.jpg?stp=dst-jpg_e15_tt6&_nc_ht=instagram.fsdu12-1.fna.fbcdn.net&_nc_cat=109&_nc_ohc=xk0PPr11jRcQ7kNvgFq_3fe&_nc_gid=51bc36fd697b4d51a1d103f8b8dfaeca&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AYA7-Hwk3X6EBbzzfLeql0TXF9_IRKmsk-kplZ0MOH3eDg&oe=676F4807&_nc_sid=8b3546';

async function loadSampleImage(): Promise<Image> {
  const res = await fetch(SAMPLE_JPEG_URL);
  if (!res.ok) {
    throw new Error(`Image download failed (${res.status})`);
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

type SignedImageAsset = {
  url: string;
  storageKey?: string;
};

function parseThumbSlugFromStorageKey(
  storageKey: string,
): { postKey: string; slot: number } | null {
  const match = storageKey.match(/\/thumbs\/([^/]+)\.[a-z0-9]+$/i);
  if (!match) return null;
  const slug = match[1];
  const slotMatch = slug.match(/^(.+)_(\d+)$/);
  if (slotMatch) {
    return {
      postKey: slotMatch[1],
      slot: Number.parseInt(slotMatch[2], 10) || 0,
    };
  }
  return { postKey: slug, slot: 0 };
}

function groupAssetsIntoPostRows(assets: SignedImageAsset[]): SignedImageAsset[][] {
  const postOrder: string[] = [];
  const byPost = new Map<
    string,
    { asset: SignedImageAsset; slot: number; sequence: number }[]
  >();

  assets.forEach((asset, sequence) => {
    const parsed = asset.storageKey
      ? parseThumbSlugFromStorageKey(asset.storageKey)
      : null;
    const postKey = parsed?.postKey ?? `__row_${sequence}`;
    const slot = parsed?.slot ?? 0;
    if (!byPost.has(postKey)) {
      postOrder.push(postKey);
      byPost.set(postKey, []);
    }
    byPost.get(postKey)!.push({ asset, slot, sequence });
  });

  return postOrder.map((postKey) => {
    const row = byPost.get(postKey)!;
    row.sort((a, b) => a.slot - b.slot || a.sequence - b.sequence);
    return row.map((item) => item.asset);
  });
}

const LAYOUT_COL_WIDTH = 280;
const LAYOUT_GAP = 16;
const LAYOUT_ROW_GAP = 24;
const LAYOUT_GRID_COLS = 3;

type LoadedImageRect = {
  rect: RectangleNode;
  height: number;
};

async function loadImageRect(
  asset: SignedImageAsset,
  colWidth: number,
  label?: string,
): Promise<LoadedImageRect | null> {
  try {
    const bytes = await fetchImageBytes(asset.url);
    const image = figma.createImage(bytes);
    const { width: imageWidth, height: imageHeight } = await image.getSizeAsync();
    if (imageWidth <= 0 || imageHeight <= 0) return null;

    const height = Math.round(colWidth * (imageHeight / imageWidth));
    const rect = figma.createRectangle();
    rect.resize(colWidth, height);
    rect.fills = [
      { type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash },
    ];
    if (label) rect.name = label;
    return { rect, height };
  } catch (e) {
    console.warn('[Insta2Figma] skip URL', asset.url.slice(0, 80), e);
    return null;
  }
}

/** Top-align numa linha; retorna a altura da linha (maior retângulo). */
function placeTopAlignedRow(
  items: LoadedImageRect[],
  y: number,
  colWidth: number,
  gap: number,
): number {
  let rowHeight = 0;
  for (let i = 0; i < items.length; i++) {
    const { rect, height } = items[i];
    rect.x = i * (colWidth + gap);
    rect.y = y;
    rowHeight = Math.max(rowHeight, height);
  }
  return rowHeight;
}

function appendLoadedRects(
  items: LoadedImageRect[],
  nodes: SceneNode[],
): void {
  for (const { rect } of items) {
    figma.currentPage.appendChild(rect);
    nodes.push(rect);
  }
}

/** Coloca imagens no canvas. Carrossel expandido → filas por post; senão → grid 3 colunas. */
async function placeSignedImages(
  assets: SignedImageAsset[],
  opts?: {
    profilePicUrl?: string;
    username?: string;
    expandCarouselImages?: boolean;
  },
): Promise<void> {
  const nodes: SceneNode[] = [];
  let ok = 0;
  let imageIndex = 0;
  const usernameNorm = parseInstagramUsername(String(opts?.username ?? ''));
  const usePostRows = opts?.expandCarouselImages === true;
  const layoutRows = usePostRows
    ? groupAssetsIntoPostRows(assets)
    : [assets];

  const labelForNext = (): string | undefined => {
    if (!usernameNorm) return undefined;
    imageIndex += 1;
    return `@${usernameNorm} - #${imageIndex}`;
  };

  if (usePostRows) {
    let y = 0;
    for (const row of layoutRows) {
      const loaded: LoadedImageRect[] = [];
      for (const asset of row) {
        const item = await loadImageRect(
          asset,
          LAYOUT_COL_WIDTH,
          labelForNext(),
        );
        if (item) {
          loaded.push(item);
          ok += 1;
        }
      }
      if (loaded.length === 0) continue;

      const rowHeight = placeTopAlignedRow(
        loaded,
        y,
        LAYOUT_COL_WIDTH,
        LAYOUT_GAP,
      );
      appendLoadedRects(loaded, nodes);
      y += rowHeight + LAYOUT_ROW_GAP;
    }
  } else {
    const loaded: LoadedImageRect[] = [];
    for (const asset of assets) {
      const item = await loadImageRect(
        asset,
        LAYOUT_COL_WIDTH,
        labelForNext(),
      );
      if (item) {
        loaded.push(item);
        ok += 1;
      }
    }

    let y = 0;
    for (let i = 0; i < loaded.length; i += LAYOUT_GRID_COLS) {
      const row = loaded.slice(i, i + LAYOUT_GRID_COLS);
      const rowHeight = placeTopAlignedRow(
        row,
        y,
        LAYOUT_COL_WIDTH,
        LAYOUT_GAP,
      );
      appendLoadedRects(row, nodes);
      y += rowHeight + LAYOUT_ROW_GAP;
    }
  }

  if (nodes.length === 0) {
    figma.notify('No images were placed on the canvas (download failures).', {
      error: true,
    });
    figma.ui.postMessage({
      type: 'import-done',
      placed: 0,
      total: assets.length,
      error: true,
    });
    return;
  }

  figma.currentPage.selection = nodes;
  figma.viewport.scrollAndZoomIntoView(nodes);
  figma.notify(
    `✅ ${ok} ${ok === 1 ? 'image' : 'images'} placed on the canvas.`,
  );
  figma.ui.postMessage({
    type: 'import-done',
    placed: ok,
    total: assets.length,
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
      requestKind?: 'initial' | 'page';
      requestId: number;
      username: string;
      maxPosts?: number;
      expandCarouselImages?: boolean;
      selectionMode?: 'recent' | 'single' | 'range' | 'multi';
      startIndex?: number;
      postCount?: number;
      timelineOrder?: 'newest_first' | 'oldest_first';
      previewListSize?: number;
      selectedIndices?: number[];
      previewPage?: number;
      after?: string;
      userId?: string;
    }
  | { type: 'create-shapes'; count: number }
  | { type: 'place-images'; urls: string[] }
  | {
      type: 'import-profile';
      username: string;
      maxPosts?: number;
      expandCarouselImages?: boolean;
      selectionMode?: 'recent' | 'single' | 'range' | 'multi';
      startIndex?: number;
      postCount?: number;
      timelineOrder?: 'newest_first' | 'oldest_first';
      selectedIndices?: number[];
      estimatedImportImages?: number;
    }
  | { type: 'session-request' }
  | { type: 'billing-checkout'; plan?: 'pro' | 'max'; cycle?: 'monthly' | 'yearly' }
  | { type: 'billing-portal' }
  | { type: 'open-external'; url: string }
  | { type: 'error'; message: unknown };

function parseApiError(payload: Record<string, unknown>): string {
  const err = payload.error as { code?: string; message?: string } | undefined;
  if (err?.message) return err.message;
  return JSON.stringify(payload).slice(0, 240);
}

const PREVIEW_RATE_LIMIT_MESSAGE =
  'Ops...our machines are almost exploding. Wait about a minute and try again.';

function formatPreviewApiError(
  status: number,
  payload: Record<string, unknown>,
): string {
  const err = payload.error as { code?: string; message?: string } | undefined;
  if (
    status === 503 ||
    err?.code === 'HTTP_503' ||
    (typeof err?.message === 'string' && err.message.includes('rate-limited'))
  ) {
    return PREVIEW_RATE_LIMIT_MESSAGE;
  }
  const message = parseApiError(payload);
  if (message && !message.startsWith('{')) {
    return message;
  }
  return 'Could not load profile preview.';
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
  const res = await apiFetch(
    `${base}/v1/auth/figma`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ figmaUserId, name }),
    },
    'auth/figma',
  );
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
  const res = await apiFetch(
    `${base}/v1/me`,
    { headers: { authorization: `Bearer ${token}` } },
    'GET /me',
  );
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!res.ok || !data) {
    const err = new Error(`GET /me ${res.status}: ${parseApiError(payload)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  const quotasRaw = data.quotas as Record<string, unknown> | undefined;
  const subRaw = data.subscription as Record<string, unknown> | undefined;
  const planTier =
    data.planTier === 'max'
      ? 'max'
      : data.planTier === 'pro'
        ? 'pro'
        : 'free';
  return {
    planTier,
    userId: String(data.userId ?? ''),
    ...(subRaw && {
      subscription: {
        currentPeriodEnd:
          typeof subRaw.currentPeriodEnd === 'string'
            ? subRaw.currentPeriodEnd
            : null,
      },
    }),
    quotas: {
      imagesRemaining:
        typeof quotasRaw?.imagesRemaining === 'number'
          ? quotasRaw.imagesRemaining
          : quotasRaw?.imagesRemaining === null
            ? null
            : typeof quotasRaw?.jobsRemaining === 'number'
              ? quotasRaw.jobsRemaining
              : 0,
      imagesLimit:
        typeof quotasRaw?.imagesLimit === 'number'
          ? quotasRaw.imagesLimit
          : quotasRaw?.imagesLimit === null
            ? null
            : typeof quotasRaw?.jobsLimit === 'number'
              ? quotasRaw.jobsLimit
              : null,
      maxPosts:
        typeof quotasRaw?.maxPosts === 'number' && Number.isFinite(quotasRaw.maxPosts)
          ? quotasRaw.maxPosts
          : 50,
      maxImagesPerJob:
        typeof quotasRaw?.maxImagesPerJob === 'number' &&
        Number.isFinite(quotasRaw.maxImagesPerJob)
          ? quotasRaw.maxImagesPerJob
          : 100,
      expandCarouselImages: quotasRaw?.expandCarouselImages === true,
      periodEnd:
        typeof quotasRaw?.periodEnd === 'string'
          ? quotasRaw.periodEnd
          : quotasRaw?.periodEnd === null
            ? null
            : null,
    },
  };
}

async function ensureSession(base: string): Promise<{
  session: StoredSession;
  me: SessionPayload;
}> {
  const figmaUser = figma.currentUser;
  if (!figmaUser?.id) {
    throw new Error('Sign in to Figma to use Insta2Figma.');
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

  try {
    const me = await fetchMe(base, stored.accessToken);
    return { session: stored, me };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 401) throw err;

    stored = await authFigmaUser(
      base,
      figmaUserId,
      figmaUser.name ?? undefined,
    );
    const me = await fetchMe(base, stored.accessToken);
    return { session: stored, me };
  }
}

async function bootstrapSession(): Promise<void> {
  const base = await getApiBase();
  console.info('[Insta2Figma] bootstrap API base:', base);
  figma.ui.postMessage({ type: 'api-base', base });
  try {
    await probeApiHealth(base);
    const { me } = await ensureSession(base);
    figma.ui.postMessage({ type: 'session-data', ...me });
  } catch (err) {
    const message = formatCaught(err);
    console.error('[Insta2Figma] bootstrapSession', { base }, err);
    figma.ui.postMessage({
      type: 'session-error',
      message,
      base,
    });
  }
}

async function openBillingCheckout(
  base: string,
  token: string,
  plan: 'pro' | 'max' = 'pro',
  cycle: 'monthly' | 'yearly' = 'monthly',
): Promise<void> {
  const res = await apiFetch(`${base}/v1/billing/checkout-session`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ plan, cycle }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as { url?: string } | undefined;
  if (!res.ok || !data?.url) {
    throw new Error(`Checkout ${res.status}: ${parseApiError(payload)}`);
  }
  figma.openExternal(data.url);
}

async function pollForPlanChange(
  base: string,
  token: string,
  knownTier: string,
): Promise<void> {
  const MAX_ATTEMPTS = 60;
  const INTERVAL_MS = 5_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
    try {
      const me = await fetchMe(base, token);
      if (me.planTier !== knownTier) {
        figma.ui.postMessage({ type: 'session-data', ...me });
        figma.notify(`✅ Plan updated to ${me.planTier}!`);
        return;
      }
    } catch {
      // network blip — keep trying
    }
  }
}

async function openBillingPortal(base: string, token: string): Promise<void> {
  const res = await apiFetch(`${base}/v1/billing/portal-session`, {
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
    estimatedImportImages?: number;
    selectionMode?: 'recent' | 'single' | 'range' | 'multi';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
    selectedIndices?: number[];
  },
): Promise<void> {
  const notifyStatus = (text: string) => {
    figma.ui.postMessage({ type: 'import-status', text });
  };

  notifyStatus(importStatusAuth());
  const { session, me } = await ensureSession(base);
  const token = session.accessToken;
  figma.ui.postMessage({ type: 'session-data', ...me });

  notifyStatus(importStatusQueue());
  const idem = `figma-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const jr = await apiFetch(`${base}/v1/jobs`, {
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
        ...(options.selectedIndices?.length
          ? { selectedIndices: options.selectedIndices }
          : {}),
        ...(options.estimatedImportImages != null &&
        Number.isFinite(options.estimatedImportImages) &&
        options.estimatedImportImages > 0
          ? { estimatedImportImages: Math.floor(options.estimatedImportImages) }
          : {}),
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
        err.message ?? 'Monthly quota used up. Upgrade to Pro to continue.',
      );
    }
    throw new Error('Could not start the import. Try again in a moment.');
  }
  const jobId = data?.id ?? legacyId;
  if (!jobId) {
    throw new Error('Could not start the import. Try again in a moment.');
  }

  notifyStatus(importStatusWaiting(1));
  let lastResultSummary: unknown = undefined;
  let lastSignedAssets: { url?: string; storageKey?: string }[] = [];
  let status = '';
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const gr = await apiFetch(`${base}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const gj = (await gr.json().catch(() => ({}))) as Record<string, unknown>;
    const gData = gj.data as Record<string, unknown> | undefined;
    if (!gr.ok) {
      throw new Error('Could not check import progress. Try again in a moment.');
    }
    status = String(gData?.status ?? gj.status ?? '');
    notifyStatus(importStatusWaiting(i + 1));
    if (status === 'succeeded') {
      lastResultSummary = gData?.resultSummary;
      const sa = gData?.signedAssets;
      if (Array.isArray(sa)) lastSignedAssets = sa;
      const rs = lastResultSummary;
      if (rs !== null && typeof rs === 'object' && !Array.isArray(rs)) {
        const sm = (rs as Record<string, unknown>).scrapingMeta;
        if (sm !== null && typeof sm === 'object' && !Array.isArray(sm)) {
          const smb = sm as Record<string, unknown>;
          const sample = smb.postsInSample;
          if (typeof sample === 'number' && Number.isFinite(sample) && sample > 0) {
            notifyStatus(importStatusPostsFound(Math.floor(sample)));
          }
        }
      }
      break;
    }
    if (status === 'failed') {
      throw new Error('Import did not finish. Try again in a moment.');
    }
  }
  if (status !== 'succeeded') {
    throw new Error('Import is taking longer than expected. Try again in a moment.');
  }

  const list = lastSignedAssets;
  const profileAsset = list.find((a) =>
    typeof a?.storageKey === 'string'
      ? /\/profile\.[a-z0-9]+$/i.test(String(a.storageKey))
      : false,
  );
  const profileUrlFromSignedAssets =
    typeof profileAsset?.url === 'string' && profileAsset.url.trim() !== ''
      ? profileAsset.url.trim()
      : undefined;
  const imageAssets: SignedImageAsset[] = list
    .filter((a) =>
      typeof a?.storageKey === 'string'
        ? !/\/profile\.[a-z0-9]+$/i.test(String(a.storageKey))
        : true,
    )
    .map((a) => ({
      url: a?.url ? String(a.url) : '',
      ...(typeof a?.storageKey === 'string' ? { storageKey: a.storageKey } : {}),
    }))
    .filter((a) => a.url.length > 0);

  if (imageAssets.length === 0) {
    console.error('[Insta2Figma] imageAssets vazios — signedAssets do job:', {
      total: lastSignedAssets.length,
      keys: lastSignedAssets.map((a) => a.storageKey ?? '(sem key)').slice(0, 10),
      urls: lastSignedAssets.map((a) => (a.url ?? '').slice(0, 60)).slice(0, 10),
    });
    throw new Error('No images came back from the import. Try again in a moment.');
  }

  notifyStatus(importStatusPlacing(imageAssets.length));
  const rawProfilePic = pickProfilePicUrlFromJobResultSummary(lastResultSummary);
  let profilePicForHistory: string | undefined;
  if (profileUrlFromSignedAssets) {
    profilePicForHistory = profileUrlFromSignedAssets;
  } else if (rawProfilePic) {
    notifyStatus(importStatusAvatar());
    profilePicForHistory =
      (await fetchInstagramAvatarAsDataUrl(rawProfilePic)) ??
      `${base}/v1/instagram/image?url=${encodeURIComponent(rawProfilePic)}`;
  }
  await placeSignedImages(imageAssets, {
    username,
    expandCarouselImages: options.expandCarouselImages,
    ...(profilePicForHistory ? { profilePicUrl: profilePicForHistory } : {}),
  });
}

function buildPreviewQueryString(
  username: string,
  opts: {
    maxPosts: number;
    expandCarouselImages: boolean;
    selectionMode?: 'recent' | 'single' | 'range' | 'multi';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
    previewListSize?: number;
    selectedIndices?: number[];
    previewPage?: number;
    after?: string;
    userId?: string;
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
  if (opts.selectedIndices?.length) {
    parts.push(
      `selectedIndices=${encodeURIComponent(opts.selectedIndices.join(','))}`,
    );
  }
  if (opts.previewPage != null) {
    parts.push(`previewPage=${encodeURIComponent(String(opts.previewPage))}`);
  }
  if (opts.after) {
    parts.push(`after=${encodeURIComponent(opts.after)}`);
  }
  if (opts.userId) {
    parts.push(`userId=${encodeURIComponent(opts.userId)}`);
  }
  return parts.join('&');
}

async function previewProfileViaApi(
  base: string,
  username: string,
  opts: {
    maxPosts: number;
    expandCarouselImages: boolean;
    selectionMode?: 'recent' | 'single' | 'range' | 'multi';
    startIndex?: number;
    postCount?: number;
    timelineOrder?: 'newest_first' | 'oldest_first';
    previewListSize?: number;
    selectedIndices?: number[];
    previewPage?: number;
    after?: string;
    userId?: string;
  },
): Promise<{
  username: string;
  profilePicUrlHd: string | null;
  profilePicDataUrl: string | null;
  mediaCount: number;
  isPrivate: boolean;
  imageCount?: number;
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
  previewPage?: number;
  previewPageSize?: number;
  previewTotalPages?: number;
  hasNextPreviewPage?: boolean;
  nextPreviewCursor?: string | null;
  instagramUserId?: string | null;
}> {
  const { session } = await ensureSession(base);
  const token = session.accessToken;
  const qs = buildPreviewQueryString(username, opts);
  const res = await apiFetch(
    `${base}/v1/instagram/profile-preview?${qs}`,
    { headers: { authorization: `Bearer ${token}` } },
    'profile-preview',
  );
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!res.ok || !data) {
    const apiMessage = typeof payload.message === 'string' ? payload.message : null;
    throw new Error(
      apiMessage ?? `Preview ${res.status}: ${JSON.stringify(payload.error ?? payload).slice(0, 240)}`,
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
    imageCount:
      typeof data.imageCount === 'number' && Number.isFinite(data.imageCount)
        ? data.imageCount
        : undefined,
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
    previewPage:
      typeof data.previewPage === 'number' && Number.isFinite(data.previewPage)
        ? data.previewPage
        : undefined,
    previewPageSize:
      typeof data.previewPageSize === 'number' && Number.isFinite(data.previewPageSize)
        ? data.previewPageSize
        : undefined,
    previewTotalPages:
      typeof data.previewTotalPages === 'number' &&
      Number.isFinite(data.previewTotalPages)
        ? data.previewTotalPages
        : undefined,
    hasNextPreviewPage: data.hasNextPreviewPage === true,
    nextPreviewCursor:
      typeof data.nextPreviewCursor === 'string' ? data.nextPreviewCursor : null,
    instagramUserId:
      typeof data.instagramUserId === 'string'
        ? data.instagramUserId
        : typeof data.instagramUserId === 'number' && Number.isFinite(data.instagramUserId)
          ? String(Math.floor(data.instagramUserId))
          : null,
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
    const base = await getApiBase();
    const plan = msg.plan === 'max' ? 'max' : 'pro';
    const cycle = msg.cycle === 'yearly' ? 'yearly' : 'monthly';
    try {
      const { session } = await ensureSession(base);
      const me = await fetchMe(base, session.accessToken);
      await openBillingCheckout(base, session.accessToken, plan, cycle);
      figma.notify('Checkout opened in your browser.');
      void pollForPlanChange(base, session.accessToken, me.planTier);
    } catch (err) {
      figma.notify(`Insta2Figma: ${formatCaught(err)}`, { error: true });
    }
    return;
  }

  if (msg.type === 'billing-portal') {
    const base = await getApiBase();
    try {
      const { session } = await ensureSession(base);
      const me = await fetchMe(base, session.accessToken);
      await openBillingPortal(base, session.accessToken);
      figma.notify('Customer portal opened in your browser.');
      void pollForPlanChange(base, session.accessToken, me.planTier);
    } catch (err) {
      figma.notify(`Insta2Figma: ${formatCaught(err)}`, { error: true });
    }
    return;
  }

  if (msg.type === 'open-external') {
    const url = typeof msg.url === 'string' ? msg.url.trim() : '';
    if (url && (/^https?:\/\//i.test(url) || /^mailto:/i.test(url))) {
      figma.openExternal(url);
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
    const base = await getApiBase();
    const username = parseInstagramUsername(String(msg.username ?? ''));
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
      figma.notify('Insta2Figma: Enter a username.', {
        error: true,
      });
      figma.ui.postMessage({
        type: 'import-error',
        message: 'Enter a username.',
      });
      return;
    }
    try {
      await importProfileViaApi(base, username, {
        maxPosts,
        expandCarouselImages,
        estimatedImportImages:
          typeof msg.estimatedImportImages === 'number' &&
          Number.isFinite(msg.estimatedImportImages)
            ? Math.floor(msg.estimatedImportImages)
            : undefined,
        selectionMode: msg.selectionMode,
        startIndex: msg.startIndex,
        postCount: msg.postCount,
        timelineOrder: msg.timelineOrder,
        selectedIndices: Array.isArray(msg.selectedIndices)
          ? msg.selectedIndices.filter((n) => typeof n === 'number').map((n) => Math.floor(n))
          : undefined,
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
    const base = await getApiBase();
    const username = parseInstagramUsername(String(msg.username ?? ''));
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
        message: 'Enter a username.',
      });
      return;
    }
    try {
      console.info('[Insta2Figma] profile-preview pedido', { base, username });
      const preview = await previewProfileViaApi(base, username, {
        maxPosts,
        expandCarouselImages,
        selectionMode: msg.selectionMode,
        startIndex: msg.startIndex,
        postCount: msg.postCount,
        timelineOrder: msg.timelineOrder,
        previewListSize: msg.previewListSize,
        previewPage: msg.previewPage,
        after: msg.after,
        userId: msg.userId,
      });
      const requestKind = msg.requestKind === 'page' ? 'page' : 'initial';
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
        requestKind,
        requestId: msg.requestId,
        username: preview.username,
        mediaCount: preview.mediaCount,
        isPrivate: preview.isPrivate,
        imageCount: preview.imageCount,
        estimatedImportImages: preview.estimatedImportImages,
        estimatedPostCovers: preview.estimatedPostCovers,
        estimatedCarouselExtras: preview.estimatedCarouselExtras,
        postsPreview: postsMeta,
        postsAvailable: preview.postsAvailable,
        selectionWarning: preview.selectionWarning,
        previewPage: preview.previewPage ?? msg.previewPage ?? 1,
        previewPageSize: preview.previewPageSize,
        previewTotalPages: preview.previewTotalPages,
        hasNextPreviewPage: preview.hasNextPreviewPage,
        nextPreviewCursor: preview.nextPreviewCursor,
        instagramUserId: preview.instagramUserId,
        thumbsPending: postsWithThumbs.length,
        ...(preview.profilePicDataUrl
          ? { profilePicUrlHd: preview.profilePicDataUrl }
          : preview.profilePicUrlHd
            ? {
                profilePicUrlHd:
                  preview.profilePicUrlHd.startsWith('data:') || preview.profilePicUrlHd.startsWith('blob:')
                    ? preview.profilePicUrlHd
                    : `${base}/v1/instagram/image?url=${encodeURIComponent(preview.profilePicUrlHd)}`,
              }
            : {}),
      });
      for (const item of postsWithThumbs) {
        const url = item.thumbnailUrl;
        if (typeof url === 'string' && url.length > 0) {
          // CDN Instagram não funciona em <img> no iframe Figma — usar proxy da API
          const proxied = url.startsWith('data:') || url.startsWith('blob:')
            ? url
            : `${base}/v1/instagram/image?url=${encodeURIComponent(url)}`;
          figma.ui.postMessage({
            type: 'profile-preview-thumb',
            requestKind,
            requestId: msg.requestId,
            shortcode: item.shortcode,
            thumbnailUrl: proxied,
          });
        }
      }
      if (postsWithThumbs.length > 0) {
        figma.ui.postMessage({
          type: 'profile-preview-thumbs-done',
          requestKind,
          requestId: msg.requestId,
        });
      }
    } catch (err) {
      const message = formatCaught(err);
      console.error('[Insta2Figma] profile-preview falhou', { base, username }, err);
      figma.ui.postMessage({
        type: 'profile-preview-error',
        requestKind: msg.requestKind === 'page' ? 'page' : 'initial',
        requestId: msg.requestId,
        message,
        ...(message !== PREVIEW_RATE_LIMIT_MESSAGE ? { base } : {}),
      });
    }
    return;
  }

  if (msg.type === 'place-images') {
    if (!Array.isArray(msg.urls) || msg.urls.length === 0) {
      figma.notify('URL list is empty.', { error: true });
      return;
    }
    try {
      await placeSignedImages(
        msg.urls.map((url) => ({ url: String(url) })),
      );
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
      figma.notify('Enter a positive whole number.', { error: true });
    return;
  }

  try {
    const image = await loadSampleImageOrNull();
    if (!image) {
      figma.notify(
        'Could not load the sample image (CDN). Creating solid rectangles instead.',
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
