import { z } from 'zod';

export const JOB_TYPES = ['SCRAPE_PROFILE', 'SCRAPE_POSTS'] as const;
export const jobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof jobTypeSchema>;

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const scrapeProfileInputSchema = z.object({
  username: z.string().min(1).max(64),
});

export type ScrapeProfileInput = z.infer<typeof scrapeProfileInputSchema>;

export const createJobBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SCRAPE_PROFILE'),
    input: scrapeProfileInputSchema,
  }),
  z.object({
    type: z.literal('SCRAPE_POSTS'),
    input: scrapeProfileInputSchema.extend({
      maxPosts: z.number().int().positive().optional(),
    }),
  }),
]);

export type CreateJobBody = z.infer<typeof createJobBodySchema>;

export const sanitizedApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type SanitizedApiError = z.infer<typeof sanitizedApiErrorSchema>;

export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema.optional(),
    error: sanitizedApiErrorSchema.optional(),
  });
}

export type ApiEnvelope<T> = {
  data?: T;
  error?: SanitizedApiError;
};

/** Nome estável da fila (arquitetura §5.3). */
export const SCRAPE_INSTAGRAM_V1_QUEUE = 'scrape-instagram-v1' as const;

/** Payload BullMQ correlacionado com `jobs.id` (UUID de negócio). */
export const scrapeInstagramV1JobPayloadSchema = z.object({
  jobId: z.string().uuid(),
});

export type ScrapeInstagramV1JobPayload = z.infer<
  typeof scrapeInstagramV1JobPayloadSchema
>;

/** Item leve do feed para `result_summary` (URLs IG podem expirar; Fase 6 armazena cópias). */
export const instagramPostSummaryItemSchema = z.object({
  shortcode: z.string(),
  thumbnailUrl: z.string().nullable(),
  isVideo: z.boolean().optional(),
});

export type InstagramPostSummaryItem = z.infer<
  typeof instagramPostSummaryItemSchema
>;

export const instagramProfileSummarySchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string().nullable(),
  biography: z.string().nullable(),
  followerCount: z.number(),
  followingCount: z.number(),
  /** Contagem total anunciada pelo IG (timeline / posts). */
  mediaCount: z.number().optional(),
  isPrivate: z.boolean(),
  isVerified: z.boolean(),
  profilePicUrlHd: z.string().nullable(),
});

export type InstagramProfileSummary = z.infer<typeof instagramProfileSummarySchema>;

/** Resultado persistido em `jobs.result_summary` após scrape real (Fase 5+). */
export const scrapeJobResultSummaryV5Schema = z.object({
  phase: z.literal(5),
  source: z.literal('instagram_web_profile_info'),
  username: z.string(),
  profile: instagramProfileSummarySchema,
  postsSample: z.array(instagramPostSummaryItemSchema),
});

export type ScrapeJobResultSummaryV5 = z.infer<
  typeof scrapeJobResultSummaryV5Schema
>;

/** Códigos sanitizados escritos em `jobs.error_code` quando o scrape falha (§9 arquitetura). */
export const INSTAGRAM_JOB_ERROR_CODES = [
  'IG_RATE_LIMIT',
  'IG_NOT_FOUND',
  'IG_UPSTREAM',
  'IG_PARSE',
  'IG_BLOCKED',
  'INTERNAL',
] as const;

export type InstagramJobErrorCode =
  (typeof INSTAGRAM_JOB_ERROR_CODES)[number];

/** URLs assinadas anexadas ao job com `GET ?include=signedAssets` (Fase 6). */
export const jobSignedAssetDtoSchema = z.object({
  id: z.string().uuid(),
  storageKey: z.string(),
  contentType: z.string(),
  url: z.string(),
  expiresAt: z.string(),
});

export type JobSignedAssetDto = z.infer<typeof jobSignedAssetDtoSchema>;
