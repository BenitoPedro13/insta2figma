import { IG_IMAGE_HEADERS } from '@insta2figma/shared-instagram';

export async function fetchInstagramImageAsDataUrl(
  cdnUrl: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const img = await fetch(cdnUrl, {
      method: 'GET',
      headers: IG_IMAGE_HEADERS,
      signal: AbortSignal.timeout(18_000),
      redirect: 'follow',
    });
    if (!img.ok) {
      console.warn(`[ig:thumb] HTTP ${img.status} — ${cdnUrl.slice(0, 80)}`);
      return null;
    }
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) {
      console.warn(`[ig:thumb] tamanho inválido: ${buf.byteLength}b — ${cdnUrl.slice(0, 80)}`);
      return null;
    }
    const ctRaw = img.headers.get('content-type')?.split(';')[0]?.trim();
    const ct = ctRaw && ctRaw.startsWith('image/') ? ctRaw : 'image/jpeg';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(`[ig:thumb] erro: ${err instanceof Error ? err.message : String(err)} — ${cdnUrl.slice(0, 80)}`);
    return null;
  }
}
