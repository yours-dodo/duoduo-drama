import { describe, expect, it } from 'vitest';

import { secret } from '../index.js';

describe('SecretValue', () => {
  it('redacts string and JSON representations', () => {
    const canary = 'sk-secret-canary-never-log';
    const value = secret(canary);

    expect(String(value)).toBe('[REDACTED]');
    expect(JSON.stringify({ value })).toBe('{"value":"[REDACTED]"}');
    expect(String(value)).not.toContain(canary);
    expect(JSON.stringify(value)).not.toContain(canary);
  });
});
