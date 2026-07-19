import { describe, expect, it } from 'vitest';
import { createEnvironmentCredentialResolver } from './ambient.js';

function mutableEnvironment(initial: Record<string, string | undefined>) {
  const values = { ...initial };
  return {
    source: { get: (name: string) => values[name] },
    set: (name: string, value: string | undefined) => {
      values[name] = value;
    },
  };
}

describe('environment credentials', () => {
  it('uses a stable process-local keyed identity and changes it when the key changes', () => {
    const environment = mutableEnvironment({ OPENAI_API_KEY: 'sk-first' });
    const resolver = createEnvironmentCredentialResolver({
      environment: environment.source,
    });
    const first = resolver.resolve({
      environmentVariable: 'OPENAI_API_KEY',
      scheme: 'Bearer',
    });
    const repeated = resolver.resolve({
      environmentVariable: 'OPENAI_API_KEY',
      scheme: 'Bearer',
    });
    expect(repeated?.credentialInstanceId).toBe(first?.credentialInstanceId);
    expect(first?.credentialIdentityLifetime).toBe('process-local');
    expect(JSON.stringify(first)).not.toContain('sk-first');

    environment.set('OPENAI_API_KEY', 'sk-second');
    const changed = resolver.resolve({
      environmentVariable: 'OPENAI_API_KEY',
      scheme: 'Bearer',
    });
    expect(changed?.credentialInstanceId).not.toBe(first?.credentialInstanceId);
    expect(JSON.stringify(changed)).not.toContain('sk-second');
  });

  it('returns undefined for missing or empty variables', () => {
    const resolver = createEnvironmentCredentialResolver({
      environment: { get: () => '' },
    });
    expect(
      resolver.resolve({
        environmentVariable: 'OPENAI_API_KEY',
        scheme: 'Bearer',
      }),
    ).toBeUndefined();
  });
});
