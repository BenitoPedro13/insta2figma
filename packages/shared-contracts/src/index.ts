import { z } from 'zod';
import {
  POST_SELECTION_MODES,
  POST_TIMELINE_ORDERS,
  endSelectionIndex,
  estimateImportImages,
  orderTimelinePosts,
  resolveScrapeSelection,
  slicePostsBySelection,
  type CarouselPostEstimate,
  type ImportImageEstimate,
  type PostSelectionMode,
  type PostTimelineOrder,
  type ResolvedScrapeSelection,
  type ScrapeSelectionInput,
} from './post-selection.js';
import {
  buildIndexedPostPreview,
  parseTimelineSampleFromUserNode,
  type InstagramPostPreviewItem,
  type TimelinePostItem,
} from './instagram-timeline-parse.js';

export {
  POST_SELECTION_MODES,
  POST_TIMELINE_ORDERS,
  endSelectionIndex,
  estimateImportImages,
  orderTimelinePosts,
  resolveScrapeSelection,
  slicePostsBySelection,
  buildIndexedPostPreview,
  parseTimelineSampleFromUserNode,
  type CarouselPostEstimate,
  type ImportImageEstimate,
  type InstagramPostPreviewItem,
  type PostSelectionMode,
  type PostTimelineOrder,
  type ResolvedScrapeSelection,
  type ScrapeSelectionInput,
  type TimelinePostItem,
};

export const postSelectionModeSchema = z.enum(POST_SELECTION_MODES);
export const postTimelineOrderSchema = z.enum(POST_TIMELINE_ORDERS);

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
  /** Nº de posts mais recentes a cobrir no scrape (timeline). Omisso = default por tipo de job. */
  maxPosts: z.number().int().min(1).max(50).optional(),
  /** Se true, imagens extra de posts tipo carrossel entram também no upload (URLs em `carouselImageUrls`). */
  expandCarouselImages: z.boolean().optional(),
  /** `recent` = comportamento legado; `single`/`range` = seleção por posição na timeline. */
  selectionMode: postSelectionModeSchema.optional(),
  /** Posição inicial 1-based na ordem escolhida (`timelineOrder`). */
  startIndex: z.number().int().min(1).max(50).optional(),
  /** Quantidade de posts no modo `range` (ignorado em `single`). */
  postCount: z.number().int().min(1).max(50).optional(),
  timelineOrder: postTimelineOrderSchema.optional(),
});

export type ScrapeProfileInput = z.infer<typeof scrapeProfileInputSchema>;

export const createJobBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SCRAPE_PROFILE'),
    input: scrapeProfileInputSchema,
  }),
  z.object({
    type: z.literal('SCRAPE_POSTS'),
    input: scrapeProfileInputSchema,
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
  /** URLs adicionais (carrossel / sidecar), sem o thumbnail principal já em `thumbnailUrl`. */
  carouselImageUrls: z.array(z.string()).optional(),
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

/** Eco do pedido do job (útil para depuração / UI — confirma que API + worker aplicaram opções). */
export const scrapeJobScrapingMetaSchema = z.object({
  requestedMaxPosts: z.number().int().min(1).max(50),
  expandCarouselImages: z.boolean(),
  /** Tamanho de `postsSample` após parse (limitado pelo pedido e pelas edges devolvidas pelo IG). */
  postsInSample: z.number().int().min(0),
  selectionMode: postSelectionModeSchema.optional(),
  startIndex: z.number().int().min(1).max(50).optional(),
  postCount: z.number().int().min(1).max(50).optional(),
  timelineOrder: postTimelineOrderSchema.optional(),
  fetchCount: z.number().int().min(1).max(50).optional(),
});

export const instagramPostPreviewItemSchema = z.object({
  index: z.number().int().min(1),
  shortcode: z.string(),
  isVideo: z.boolean().optional(),
  takenAt: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  carouselCount: z.number().int().min(1).optional(),
});

export type InstagramPostPreviewItemDto = z.infer<
  typeof instagramPostPreviewItemSchema
>;

export type ScrapeJobScrapingMeta = z.infer<typeof scrapeJobScrapingMetaSchema>;

/** Resultado persistido em `jobs.result_summary` após scrape real (Fase 5+). */
export const scrapeJobResultSummaryV5Schema = z.object({
  phase: z.literal(5),
  source: z.literal('instagram_web_profile_info'),
  username: z.string(),
  profile: instagramProfileSummarySchema,
  postsSample: z.array(instagramPostSummaryItemSchema),
  scrapingMeta: scrapeJobScrapingMetaSchema.optional(),
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

/** Tiers de subscrição (Fase 7 — Polar). */
export const PLAN_TIERS = ['free', 'pro'] as const;
export const planTierSchema = z.enum(PLAN_TIERS);
export type PlanTier = z.infer<typeof planTierSchema>;

export const meQuotasSchema = z.object({
  jobsRemaining: z.number().int().min(0).nullable(),
  jobsLimit: z.number().int().min(0).nullable(),
  maxPosts: z.number().int().min(1),
  expandCarouselImages: z.boolean(),
});

export type MeQuotas = z.infer<typeof meQuotasSchema>;

export const meSubscriptionSchema = z.object({
  status: z.string(),
  currentPeriodEnd: z.string().nullable(),
});

export type MeSubscription = z.infer<typeof meSubscriptionSchema>;

export const meResponseSchema = z.object({
  userId: z.string().uuid(),
  planTier: planTierSchema,
  quotas: meQuotasSchema,
  subscription: meSubscriptionSchema.optional(),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const QUOTA_EXCEEDED_ERROR_CODE = 'QUOTA_EXCEEDED' as const;

export const billingSessionUrlSchema = z.object({
  url: z.string().url(),
});

export type BillingSessionUrl = z.infer<typeof billingSessionUrlSchema>;
