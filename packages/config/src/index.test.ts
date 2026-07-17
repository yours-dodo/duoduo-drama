import { describe, expect, it } from 'vitest';

import { requiredEnv } from './index.js';

describe('requiredEnv', () => {
  it('returns a normalized value', () => {
    expect(requiredEnv({ PORT: ' 3000 ' }, 'PORT')).toBe('3000');
  });

  it('reports a missing value', () => {
    expect(() => requiredEnv({}, 'PORT')).toThrow(
      'Missing required environment variable: PORT',
    );
  });
});
