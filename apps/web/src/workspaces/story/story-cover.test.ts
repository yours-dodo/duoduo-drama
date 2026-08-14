import { describe, expect, it } from 'vitest';

import {
  getStoryCoverVariant,
  hasStoryCover,
  storyCoverVariants,
} from './story-cover';

describe('story cover presentation helpers', () => {
  it('treats only a non-empty cover URL as a real cover', () => {
    expect(
      hasStoryCover({ coverUrl: 'https://cdn.example.test/cover.jpg' }),
    ).toBe(true);
    expect(hasStoryCover({ coverUrl: '   ' })).toBe(false);
    expect(hasStoryCover({ coverUrl: '' })).toBe(false);
    expect(hasStoryCover({ coverUrl: null })).toBe(false);
    expect(hasStoryCover({})).toBe(false);
  });

  it('returns a stable default variant for every project ID', () => {
    const first = getStoryCoverVariant('project-rain-before');

    expect(getStoryCoverVariant('project-rain-before')).toBe(first);
    expect(storyCoverVariants).toContain(first);
    expect(storyCoverVariants).toContain(getStoryCoverVariant(''));
  });
});
