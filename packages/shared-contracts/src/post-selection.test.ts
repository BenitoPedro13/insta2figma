import { describe, expect, it } from 'vitest';
import {
  endSelectionIndex,
  estimateImportImages,
  resolveScrapeSelection,
  slicePostsBySelection,
} from './post-selection';

describe('resolveScrapeSelection', () => {
  it('modo recent mantém comportamento legado', () => {
    expect(resolveScrapeSelection({ maxPosts: 12 })).toEqual({
      mode: 'recent',
      timelineOrder: 'newest_first',
      startIndex: 1,
      postCount: 12,
      fetchCount: 12,
    });
  });

  it('modo single pede fetch até a posição', () => {
    expect(
      resolveScrapeSelection({
        selectionMode: 'single',
        startIndex: 10,
      }),
    ).toEqual({
      mode: 'single',
      timelineOrder: 'newest_first',
      startIndex: 10,
      postCount: 1,
      fetchCount: 10,
    });
  });

  it('modo range calcula fetchCount pelo fim do intervalo', () => {
    const sel = resolveScrapeSelection({
      selectionMode: 'range',
      startIndex: 10,
      postCount: 5,
    });
    expect(sel.postCount).toBe(5);
    expect(endSelectionIndex(sel)).toBe(14);
    expect(sel.fetchCount).toBe(14);
  });

  it('modo multi usa o maior índice como fetchCount', () => {
    const sel = resolveScrapeSelection({
      selectionMode: 'multi',
      selectedIndices: [1, 3, 7],
    });
    expect(sel.selectedIndices).toEqual([1, 3, 7]);
    expect(sel.fetchCount).toBe(7);
    expect(endSelectionIndex(sel)).toBe(7);
  });
});

describe('slicePostsBySelection', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('fatia intervalo em ordem newest_first', () => {
    const sel = resolveScrapeSelection({
      selectionMode: 'range',
      startIndex: 2,
      postCount: 2,
    });
    expect(slicePostsBySelection(items, sel)).toEqual(['b', 'c']);
  });

  it('inverte ordem com oldest_first', () => {
    const sel = resolveScrapeSelection({
      selectionMode: 'single',
      startIndex: 1,
      timelineOrder: 'oldest_first',
    });
    expect(slicePostsBySelection(items, sel)).toEqual(['e']);
  });

  it('modo multi escolhe posições específicas', () => {
    const sel = resolveScrapeSelection({
      selectionMode: 'multi',
      selectedIndices: [1, 3, 5],
    });
    expect(slicePostsBySelection(items, sel)).toEqual(['a', 'c', 'e']);
  });
});

describe('estimateImportImages', () => {
  it('conta extras de carrossel quando expandido', () => {
    const posts = [
      { shortcode: 'a', thumbnailUrl: 'x', carouselImageUrls: ['b', 'c'] },
      { shortcode: 'd', thumbnailUrl: 'y' },
    ];
    const sel = resolveScrapeSelection({ maxPosts: 2 });
    expect(estimateImportImages(posts, sel, true)).toEqual({
      estimatedPostCovers: 2,
      estimatedCarouselExtras: 2,
      estimatedImportImages: 4,
    });
  });
});
