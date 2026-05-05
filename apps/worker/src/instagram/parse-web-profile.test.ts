import { describe, expect, it } from 'vitest';
import { scrapeJobResultSummaryV5Schema } from '@insta2figma/shared-contracts';

import { buildScrapeSummaryV5FromUserNode } from './parse-web-profile';

describe('buildScrapeSummaryV5FromUserNode', () => {
  const minimalUser = {
    id: '123',
    username: 'fixture',
    full_name: 'Fixture User',
    biography: 'hello',
    is_private: false,
    is_verified: false,
    profile_pic_url_hd: 'https://example.test/p.jpg',
    edge_followed_by: { count: 100 },
    edge_follow: { count: 5 },
    edge_owner_to_timeline_media: {
      count: 2,
      edges: [
        {
          node: {
            shortcode: 'abc123xyz',
            display_url: 'https://example.test/thumb.jpg',
            __typename: 'GraphImage',
          },
        },
      ],
    },
  };

  it('extrai perfil e amostra de posts', () => {
    const summary = buildScrapeSummaryV5FromUserNode(
      'fixture',
      minimalUser,
      10,
    );
    expect(scrapeJobResultSummaryV5Schema.parse(summary)).toEqual(summary);
    expect(summary.profile.followerCount).toBe(100);
    expect(summary.postsSample).toHaveLength(1);
    expect(summary.postsSample[0]?.shortcode).toBe('abc123xyz');
  });

  it('respeita o limite de posts', () => {
    const manyEdges = Array.from({ length: 30 }, (_, i) => ({
      node: {
        shortcode: `p${i}`,
        display_url: 'https://x',
        __typename: 'GraphImage',
      },
    }));

    const user = {
      ...minimalUser,
      edge_owner_to_timeline_media: { count: 30, edges: manyEdges },
    };

    const summary = buildScrapeSummaryV5FromUserNode(
      'fixture',
      user,
      5,
    );
    expect(summary.postsSample).toHaveLength(5);
  });

  it('lista URLs de carrossel quando presentes', () => {
    const userWithSidecar = {
      ...minimalUser,
      edge_owner_to_timeline_media: {
        count: 1,
        edges: [
          {
            node: {
              shortcode: 'side1',
              display_url: 'https://example.test/cover.jpg',
              __typename: 'GraphSidecar',
              edge_sidecar_to_children: {
                edges: [
                  {
                    node: { display_url: 'https://example.test/a.jpg' },
                  },
                  {
                    node: { display_url: 'https://example.test/b.jpg' },
                  },
                ],
              },
            },
          },
        ],
      },
    };
    const summary = buildScrapeSummaryV5FromUserNode(
      'fixture',
      userWithSidecar,
      10,
    );
    expect(summary.postsSample[0]?.carouselImageUrls).toEqual([
      'https://example.test/a.jpg',
      'https://example.test/b.jpg',
    ]);
  });
});
