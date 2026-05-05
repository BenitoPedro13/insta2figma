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
