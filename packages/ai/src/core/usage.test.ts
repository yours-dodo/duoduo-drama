import { describe, expect, it } from 'vitest';

import type { ModelDefinition } from './models.js';
import { calculateCost } from './usage.js';

const model: ModelDefinition = {
  id: 'priced',
  upstreamModelId: 'priced',
  name: 'Priced',
  providerInstanceId: 'fixture',
  protocol: 'fixture',
  protocolProfileId: 'fixture',
  capabilities: {
    input: ['text'],
    streaming: true,
    reasoning: false,
    toolCalling: false,
    parallelToolCalls: false,
    deferredTools: false,
    thinkingLevels: ['none'],
  },
  limits: { contextTokens: 1, maxOutputTokens: 1 },
  pricing: {
    currency: 'USD',
    unit: 'per_million_tokens',
    rates: {
      cacheWrite: 10,
      cacheWriteByRetention: { standard: 12.5, one_hour: 20 },
    },
  },
};

describe('calculateCost', () => {
  it('does not double-count aggregate cache writes when retention buckets are priced', () => {
    expect(
      calculateCost(model, {
        cacheWriteTokens: 300,
        cacheWriteTokensByRetention: { standard: 100, one_hour: 200 },
      }),
    ).toMatchObject({
      cacheWriteByRetention: { standard: 0.00125, one_hour: 0.004 },
      total: 0.00525,
    });
  });
});
