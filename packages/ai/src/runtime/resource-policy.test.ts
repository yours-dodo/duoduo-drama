import { describe, expect, it } from 'vitest';

import { createAi, type RuntimeResourcePolicyInput } from './create-ai.js';

describe('runtime resource policy', () => {
  const invalidPolicies: readonly [
    label: string,
    policy: RuntimeResourcePolicyInput,
    error: RegExp,
  ][] = [
    [
      'stream queue event limit',
      { streamQueue: { maxEvents: 7 } },
      /maxEvents/,
    ],
    ['session idle TTL', { session: { idleTtlMs: 59_999 } }, /idleTtlMs/],
    ['session count', { session: { maxSessions: 0 } }, /maxSessions/],
    [
      'per-session resource count',
      { session: { maxResourcesPerSession: 257 } },
      /maxResourcesPerSession/,
    ],
  ];

  it.each(invalidPolicies)(
    'rejects an invalid %s when the runtime is created',
    (_label, resourcePolicy, error) => {
      expect(() => createAi({ resourcePolicy })).toThrowError(error);
    },
  );

  it('rejects the retired runtime catalog policy instead of ignoring it', () => {
    expect(() =>
      createAi({
        resourcePolicy: {
          catalog: { staleIfErrorMs: 60_000 },
        } as unknown as RuntimeResourcePolicyInput,
      }),
    ).toThrowError(/catalog.*not supported/i);
  });
});
