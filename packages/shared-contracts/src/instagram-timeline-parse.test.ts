import { describe, expect, it } from 'vitest';
import {
  parseTimelineSampleFromUserNode,
  buildIndexedPostPreview,
} from './instagram-timeline-parse';

describe('parseTimelineSampleFromUserNode — takenAt/caption', () => {
  const userNode = {
    edge_owner_to_timeline_media: {
      edges: [
        {
          node: {
            shortcode: 'AAA',
            display_url: 'https://cdn/a.jpg',
            __typename: 'GraphImage',
            taken_at_timestamp: 1_700_000_000,
            edge_media_to_caption: {
              edges: [{ node: { text: 'hello world' } }],
            },
          },
        },
        {
          node: {
            shortcode: 'BBB',
            display_url: 'https://cdn/b.jpg',
            __typename: 'GraphVideo',
            // sem taken_at_timestamp → takenAt null
          },
        },
      ],
    },
  };

  it('extrai taken_at_timestamp (segundos unix) e caption', () => {
    const posts = parseTimelineSampleFromUserNode(userNode, 10);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      shortcode: 'AAA',
      takenAt: 1_700_000_000,
      caption: 'hello world',
      isVideo: false,
    });
    expect(posts[1]).toMatchObject({ shortcode: 'BBB', takenAt: null, isVideo: true });
  });

  it('buildIndexedPostPreview converte takenAt para ISO string', () => {
    const posts = parseTimelineSampleFromUserNode(userNode, 10);
    const preview = buildIndexedPostPreview(posts, 'newest_first', { indexStart: 1 });
    expect(preview[0].takenAt).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(preview[1].takenAt).toBeNull();
  });
});
