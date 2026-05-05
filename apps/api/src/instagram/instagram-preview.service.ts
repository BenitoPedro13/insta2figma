import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const IG_HEADERS: Record<string, string> = {
  'x-ig-app-id': '936619743392459',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.instagram.com/',
  Origin: 'https://www.instagram.com',
};
const IG_IMAGE_HEADERS: Record<string, string> = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (compatible; Insta2FigmaApi/1.0; +https://www.instagram.com/)',
  Referer: 'https://www.instagram.com/',
};
const MAX_AVATAR_BYTES = 900_000;

function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/u, '').toLowerCase();
}

function toRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

@Injectable()
export class InstagramPreviewService {
  async getProfilePreview(usernameRaw: string): Promise<{
    username: string;
    profilePicUrlHd: string | null;
    profilePicDataUrl: string | null;
    mediaCount: number;
    isPrivate: boolean;
  }> {
    const username = normalizeUsername(usernameRaw);
    if (!username) {
      throw new BadRequestException('username é obrigatório.');
    }

    const url = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: IG_HEADERS,
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Falha de rede ao consultar preview do Instagram.',
      );
    }

    if (res.status === 404) {
      throw new BadRequestException('Username não encontrado no Instagram.');
    }
    if (res.status === 429) {
      throw new ServiceUnavailableException(
        'Instagram com rate limit no preview. Tenta novamente.',
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `Instagram preview indisponível (HTTP ${res.status}).`,
      );
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const envelope = toRecord(body);
    const data = toRecord(envelope?.data);
    const user = toRecord(data?.user);
    if (!user) {
      throw new BadRequestException('Perfil Instagram não encontrado.');
    }

    const edge = toRecord(user.edge_owner_to_timeline_media);
    const countRaw = edge?.count;
    const mediaCount =
      typeof countRaw === 'number' && Number.isFinite(countRaw)
        ? countRaw
        : 0;
    const hd =
      typeof user.profile_pic_url_hd === 'string'
        ? user.profile_pic_url_hd
        : typeof user.profile_pic_url === 'string'
          ? user.profile_pic_url
          : null;
    let profilePicDataUrl: string | null = null;
    if (hd) {
      try {
        const img = await fetch(hd, {
          method: 'GET',
          headers: IG_IMAGE_HEADERS,
          signal: AbortSignal.timeout(20_000),
          redirect: 'follow',
        });
        if (img.ok) {
          const buf = Buffer.from(await img.arrayBuffer());
          if (buf.byteLength > 0 && buf.byteLength <= MAX_AVATAR_BYTES) {
            const ctRaw = img.headers.get('content-type')?.split(';')[0]?.trim();
            const ct = ctRaw && ctRaw.startsWith('image/') ? ctRaw : 'image/jpeg';
            profilePicDataUrl = `data:${ct};base64,${buf.toString('base64')}`;
          }
        }
      } catch {
        profilePicDataUrl = null;
      }
    }

    return {
      username:
        typeof user.username === 'string' && user.username
          ? user.username
          : username,
      profilePicUrlHd: hd,
      profilePicDataUrl,
      mediaCount,
      isPrivate: user.is_private === true,
    };
  }
}
