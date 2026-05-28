import { describe, expect, it } from 'vitest';
import { maxAccessiblePreviewPage } from './preview-limits';

describe('maxAccessiblePreviewPage', () => {
  it('limits free to 3 pages', () => {
    expect(maxAccessiblePreviewPage('free', 20)).toBe(3);
  });

  it('limits pro to 12 pages', () => {
    expect(maxAccessiblePreviewPage('pro', 20)).toBe(12);
  });

  it('allows max through total pages', () => {
    expect(maxAccessiblePreviewPage('max', 20)).toBe(20);
  });
});
