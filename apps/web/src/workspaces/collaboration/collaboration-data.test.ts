import { describe, expect, it } from 'vitest';

import {
  demoCollaborationPosts,
  filterCollaborationPosts,
} from './collaboration-data';

describe('collaboration demo data', () => {
  it('filters by forum category', () => {
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'idea'),
    ).toHaveLength(1);
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'project').every(
        (post) => post.category === 'project',
      ),
    ).toBe(true);
  });

  it('searches across titles, authors, projects, and tags', () => {
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'all', '空间站')[0]
        ?.title,
    ).toContain('轨道之外');
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'all', '人物弧光')[0]
        ?.author,
    ).toBe('NINE');
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'all', '不存在的讨论'),
    ).toHaveLength(0);
  });

  it('returns all posts for an empty query', () => {
    expect(
      filterCollaborationPosts(demoCollaborationPosts, 'all', '  '),
    ).toEqual(demoCollaborationPosts);
  });
});
