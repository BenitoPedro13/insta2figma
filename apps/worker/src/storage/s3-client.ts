import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export function isS3Configured(): boolean {
  const e = process.env.S3_ENDPOINT?.trim();
  const b = process.env.S3_BUCKET?.trim();
  const k = process.env.S3_ACCESS_KEY?.trim();
  const s = process.env.S3_SECRET_KEY?.trim();
  return Boolean(e && b && k !== undefined && s !== undefined);
}

/** Cliente para upload (worker) — endpoint interno (ex.: http://127.0.0.1:9000). */
export function createS3PutClient(): S3Client | null {
  if (!isS3Configured()) return null;
  const endpoint = process.env.S3_ENDPOINT!.trim();
  const region = process.env.S3_REGION?.trim() || 'us-east-1';
  return new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle:
      (process.env.S3_FORCE_PATH_STYLE ?? 'true').toLowerCase() !== 'false',
  });
}

/** Prefixo de chaves no bucket para um job. */
export function jobStoragePrefix(jobId: string): string {
  return `jobs/${jobId}/`;
}

export async function putObjectBytes(opts: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<void> {
  await opts.client.send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType,
    }),
  );
}
