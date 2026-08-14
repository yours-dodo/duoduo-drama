import { describe, expect, it } from 'vitest';

import { createDemoWorks, searchWorks } from './works-data';

describe('works demo data', () => {
  it('creates a stable catalog with unique ids', () => {
    const works = createDemoWorks(24);

    expect(works).toHaveLength(24);
    expect(new Set(works.map((work) => work.id)).size).toBe(24);
    expect(works.every((work) => /^\d{2}:\d{2}$/.test(work.duration))).toBe(
      true,
    );
    expect(works.every((work) => work.videoKindLabel.endsWith('视频'))).toBe(
      true,
    );
  });

  it('searches titles, authors, kinds, and tags case-insensitively', () => {
    const works = createDemoWorks(24);

    expect(searchWorks(works, '潮汐')[0]?.title).toContain('潮汐档案');
    expect(searchWorks(works, 'k. n.')[0]?.author).toBe('K. N.');
    expect(
      searchWorks(works, '短剧').every((work) => work.kind === 'drama'),
    ).toBe(true);
    expect(searchWorks(works, '不存在的作品')).toHaveLength(0);
  });

  it('returns the full catalog for an empty query', () => {
    const works = createDemoWorks(8);

    expect(searchWorks(works, '  ')).toEqual(works);
  });
});
