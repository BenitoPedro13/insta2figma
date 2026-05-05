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

figma.showUI(__html__, { width: 380, height: 480 });

/** Alinhado com `historyStorage.ts` HISTORY_STORAGE_KEY — persistência via `clientStorage`. */
const HISTORY_STORAGE_KEY = 'insta2figma:history:v1';

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

/** Coloca imagens em grelha (URLs presign MinIO/S3). */
async function placeSignedImages(urls: string[]): Promise<void> {
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
  });
}

type PluginMessage =
  | { type: 'cancel' }
  | { type: 'history-request' }
  /** Guardado em `figma.clientStorage` (persiste entre sessões; o `localStorage` do iframe não). */
  | { type: 'history-save'; entries: unknown }
  | { type: 'create-shapes'; count: number }
  | { type: 'place-images'; urls: string[] }
  | {
      type: 'import-profile';
      base: string;
      email: string;
      username: string;
      maxPosts?: number;
      expandCarouselImages?: boolean;
    }
  | { type: 'error'; message: unknown };

function normBase(b: string): string {
  return String(b ?? '')
    .trim()
    .replace(/\/+$/, '');
}

async function getToken(base: string, email: string): Promise<string> {
  const reg = await fetch(`${base}/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const regJ = (await reg.json().catch(() => ({}))) as Record<string, unknown>;
  const regData = regJ.data as { accessToken?: string } | undefined;
  if (reg.ok && regData?.accessToken) {
    return regData.accessToken;
  }
  const login = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const loginJ = (await login.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const loginData = loginJ.data as { accessToken?: string } | undefined;
  const loginErr = loginJ.error as { code?: string; message?: string } | undefined;
  const regErr = regJ.error as { code?: string; message?: string } | undefined;
  if (!login.ok || !loginData?.accessToken) {
    throw new Error(
      `Auth (register ${reg.status}, login ${login.status}): ${JSON.stringify(
        loginErr ?? regErr ?? loginJ,
      ).slice(0, 240)}`,
    );
  }
  return loginData.accessToken;
}

async function importProfileViaApi(
  base: string,
  email: string,
  username: string,
  options: { maxPosts: number; expandCarouselImages: boolean },
): Promise<void> {
  const notifyStatus = (text: string) => {
    figma.ui.postMessage({ type: 'import-status', text });
  };

  notifyStatus('A autenticar…');
  const token = await getToken(base, email);

  notifyStatus(
    `A criar job (${options.maxPosts} posts recentes · carrossel: ${options.expandCarouselImages ? 'todas as imagens' : 'só capa'})…`,
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
      },
    }),
  });
  const jobBody = (await jr.json().catch(() => ({}))) as Record<string, unknown>;
  const data = jobBody.data as { id?: string } | undefined;
  const legacyId = typeof jobBody.id === 'string' ? jobBody.id : undefined;
  if (!jr.ok) {
    throw new Error(`${jr.status}: ${JSON.stringify(jobBody)}`);
  }
  const jobId = data?.id ?? legacyId;
  if (!jobId) {
    throw new Error('Sem id no job.');
  }

  notifyStatus(`Job ${jobId} — a aguardar…`);
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
    if (status === 'succeeded') break;
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
  const sData = sj.data as { signedAssets?: { url?: string }[] } | undefined;
  if (!sr.ok) {
    throw new Error(`${sr.status}: ${JSON.stringify(sj)}`);
  }
  const fromData = sData?.signedAssets;
  const fromRoot = sj.signedAssets as { url?: string }[] | undefined;
  const list = Array.isArray(fromData)
    ? fromData
    : Array.isArray(fromRoot)
      ? fromRoot
      : [];
  const urls = list
    .map((a) => (a?.url ? String(a.url) : ''))
    .filter(Boolean);

  if (urls.length === 0) {
    throw new Error('Nenhuma imagem guardada — verifica MinIO/worker.');
  }

  notifyStatus(`A colocar ${urls.length} imagem(ns) no canvas…`);
  await placeSignedImages(urls);
}

figma.ui.onmessage = async (msg: PluginMessage) => {
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
    const base = normBase(msg.base);
    const email = String(msg.email ?? '').trim();
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
    if (!base || !email || !username) {
      figma.notify('Insta2Figma: Preenche API, email e username.', {
        error: true,
      });
      figma.ui.postMessage({
        type: 'import-error',
        message: 'Preenche API, email e username.',
      });
      return;
    }
    try {
      await importProfileViaApi(base, email, username, {
        maxPosts,
        expandCarouselImages,
      });
    } catch (err) {
      const text = formatCaught(err);
      console.error('[Insta2Figma] import-profile', err);
      figma.notify(`Insta2Figma: ${text}`, { error: true });
      figma.ui.postMessage({ type: 'import-error', message: text });
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
