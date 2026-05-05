import { describe, expect, it } from 'vitest';
import {
  createJobBodySchema,
  jobStatusSchema,
  jobTypeSchema,
  scrapeInstagramV1JobPayloadSchema,
  scrapeJobResultSummaryV5Schema,
} from './index';

describe('jobTypeSchema', () => {
  it('aceita valores conhecidos', () => {
    expect(jobTypeSchema.parse('SCRAPE_PROFILE')).toBe('SCRAPE_PROFILE');
  });

  it('rejeita tipos inválidos', () => {
    expect(() => jobTypeSchema.parse('UNKNOWN')).toThrow();
  });
});

describe('jobStatusSchema', () => {
  it('aceita estado queued', () => {
    expect(jobStatusSchema.parse('queued')).toBe('queued');
  });
});

describe('createJobBodySchema', () => {
  it('aceita SCRAPE_PROFILE com username', () => {
    const parsed = createJobBodySchema.parse({
      type: 'SCRAPE_PROFILE',
      input: { username: 'instagram' },
    });
    expect(parsed.type).toBe('SCRAPE_PROFILE');
  });

  it('aceita maxPosts e expandCarouselImages', () => {
    const parsed = createJobBodySchema.parse({
      type: 'SCRAPE_PROFILE',
      input: {
        username: 'instagram',
        maxPosts: 12,
        expandCarouselImages: true,
      },
    });
    expect(parsed).toMatchObject({
      type: 'SCRAPE_PROFILE',
      input: {
        username: 'instagram',
        maxPosts: 12,
        expandCarouselImages: true,
      },
    });
  });

  it('rejeita username vazio', () => {
    expect(() =>
      createJobBodySchema.parse({
        type: 'SCRAPE_PROFILE',
        input: { username: '' },
      }),
    ).toThrow();
  });
});

describe('scrapeInstagramV1JobPayloadSchema', () => {
  it('aceita jobId uuid', () => {
    const parsed = scrapeInstagramV1JobPayloadSchema.parse({
      jobId: '00000000-0000-4000-8000-000000000001',
    });
    expect(parsed.jobId).toBe('00000000-0000-4000-8000-000000000001');
  });
});

describe('scrapeJobResultSummaryV5Schema', () => {
  it('valida exemplo mínimo de resultado da Fase 5', () => {
    const data = scrapeJobResultSummaryV5Schema.parse({
      phase: 5,
      source: 'instagram_web_profile_info',
      username: 'demo',
      profile: {
        id: '1',
        username: 'demo',
        fullName: 'Demo',
        biography: '',
        followerCount: 1,
        followingCount: 0,
        mediaCount: 2,
        isPrivate: false,
        isVerified: false,
        profilePicUrlHd: 'https://example.com/p.jpg',
      },
      postsSample: [
        { shortcode: 'abc', thumbnailUrl: 'https://t', isVideo: false },
      ],
    });
    expect(data.postsSample).toHaveLength(1);
  });
});
