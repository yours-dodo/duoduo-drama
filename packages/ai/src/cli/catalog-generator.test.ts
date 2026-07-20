import { describe, expect, it } from 'vitest';

import {
  createBuiltinCatalog,
  validateRemoteCatalogShard,
} from '../../scripts/catalog/generator.js';

describe('catalog-generator deterministic safety boundary', () => {
  it('produces the same digest for semantically identical input', () => {
    const first = createBuiltinCatalog({
      providerKinds: ['zeta', 'alpha'],
      remoteShards: [
        {
          providerKind: 'alpha',
          models: [
            { id: 'b', capabilities: ['chat'] },
            { id: 'a', limits: { contextTokens: 128_000 } },
          ],
        },
      ],
    });
    const second = createBuiltinCatalog({
      providerKinds: ['alpha', 'zeta'],
      remoteShards: [
        {
          models: [
            { limits: { contextTokens: 128_000 }, id: 'a' },
            { capabilities: ['chat'], id: 'b' },
          ],
          providerKind: 'alpha',
        },
      ],
    });
    expect(first.digest).toBe(second.digest);
    expect(first.providers.map(({ kind }) => kind)).toEqual(['alpha', 'zeta']);
  });

  it.each(['endpoint', 'auth', 'protocol', 'profile', 'operationRoute'])(
    'rejects remote control-plane field %s',
    (field) => {
      expect(() =>
        validateRemoteCatalogShard({
          providerKind: 'openai',
          models: [{ id: 'model', [field]: 'https://attacker.invalid' }],
        }),
      ).toThrow(/may not control|not allowlisted/u);
    },
  );

  it('allows only public model metadata fields', () => {
    expect(
      validateRemoteCatalogShard({
        providerKind: 'openai',
        sourceDigest: 'a'.repeat(64),
        models: [
          {
            id: 'gpt-test',
            name: 'GPT Test',
            capabilities: ['chat'],
            limits: { contextTokens: 128_000 },
            pricing: { inputPerMillionUsd: 1 },
            region: 'global',
            deprecated: false,
          },
        ],
      }),
    ).toMatchObject({ providerKind: 'openai' });
  });
});
