import { describe, expect, it } from 'vitest';
import {
  createJobBodySchema,
  jobStatusSchema,
  jobTypeSchema,
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

  it('rejeita username vazio', () => {
    expect(() =>
      createJobBodySchema.parse({
        type: 'SCRAPE_PROFILE',
        input: { username: '' },
      }),
    ).toThrow();
  });
});
