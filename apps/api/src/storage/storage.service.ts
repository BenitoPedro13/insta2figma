import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class StorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly presignSeconds: number;

  constructor(config: ConfigService) {
    const endpoint =
      config.get<string>('PUBLIC_S3_ENDPOINT')?.trim() ||
      config.get<string>('S3_ENDPOINT')?.trim() ||
      '';
    const bucket = config.get<string>('S3_BUCKET')?.trim() || '';
    const accessKeyId = config.get<string>('S3_ACCESS_KEY')?.trim() ?? '';
    const secretAccessKey = config.get<string>('S3_SECRET_KEY')?.trim() ?? '';
    const region = config.get<string>('S3_REGION')?.trim() || 'us-east-1';

    const forcePath =
      (config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true').toLowerCase() !==
      'false';

    const rawSec =
      config.get<string>('ASSET_PRESIGN_SECONDS')?.trim() ?? '3600';
    this.presignSeconds = Math.min(
      7 * 24 * 3600,
      Math.max(60, Number.parseInt(rawSec, 10) || 3600),
    );

    if (
      !endpoint ||
      !bucket ||
      accessKeyId.length === 0 ||
      secretAccessKey.length === 0
    ) {
      console.warn(
        `[storage-api] S3 NÃO configurado — endpoint=${endpoint || '(vazio)'} bucket=${bucket || '(vazio)'} accessKey=${accessKeyId ? '✓' : '(vazio)'} secretKey=${secretAccessKey ? '✓' : '(vazio)'}`,
      );
      this.client = null;
      this.bucket = null;
    } else {
      console.info(`[storage-api] S3 configurado — endpoint=${endpoint} bucket=${bucket}`);
      this.bucket = bucket;
      this.client = new S3Client({
        region,
        endpoint,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: forcePath,
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.bucket !== null;
  }

  async signGetObjects(
    storageKeys: string[],
  ): Promise<
    Array<{ storageKey: string; url: string; expiresAt: string }>
  > {
    if (!this.client || !this.bucket || storageKeys.length === 0) return [];

    const out: Array<{ storageKey: string; url: string; expiresAt: string }> =
      [];
    const exp = new Date(Date.now() + this.presignSeconds * 1000);
    const expiresAt = exp.toISOString();

    for (const storageKey of storageKeys) {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: this.presignSeconds,
      });
      out.push({ storageKey, url, expiresAt });
    }
    return out;
  }
}
