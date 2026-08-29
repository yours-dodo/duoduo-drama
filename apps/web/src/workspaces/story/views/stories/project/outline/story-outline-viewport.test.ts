import { describe, expect, it } from 'vitest';

import { shouldFitOutlineViewOnInitialization } from './story-outline-viewport';

describe('story outline viewport initialization', () => {
  it('fits the first initialization and view changes only', () => {
    expect(
      shouldFitOutlineViewOnInitialization(null, 'timeline-horizontal'),
    ).toBe(true);
    expect(
      shouldFitOutlineViewOnInitialization(
        'timeline-horizontal',
        'timeline-horizontal',
      ),
    ).toBe(false);
    expect(
      shouldFitOutlineViewOnInitialization(
        'timeline-horizontal',
        'timeline-vertical',
      ),
    ).toBe(true);
  });
});
