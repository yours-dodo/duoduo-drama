import { describe, expect, it } from 'vitest';

import { evaluateLiveRun } from './live-policy.js';

const baseEnvironment = Object.freeze({
  DUODUO_AI_LIVE: '1',
  DUODUO_AI_LIVE_PROVIDERS: 'openai,qwen',
  DUODUO_AI_LIVE_MAX_USD: '0.25',
});

const baseRequest = Object.freeze({
  provider: 'openai',
  model: 'gpt-test',
  capability: 'chat' as const,
  allowPaid: true,
  estimatedMaxUsd: 0.1,
});

describe('cli live safety policy', () => {
  it.each([
    [{ ...baseEnvironment, DUODUO_AI_LIVE: undefined }, 'LIVE_DISABLED'],
    [
      { ...baseEnvironment, DUODUO_AI_LIVE_PROVIDERS: 'qwen' },
      'PROVIDER_NOT_ALLOWED',
    ],
    [
      { ...baseEnvironment, DUODUO_AI_LIVE_MAX_USD: undefined },
      'USD_BUDGET_REQUIRED',
    ],
  ] as const)('requires every environment opt-in', (environment, code) => {
    expect(evaluateLiveRun(baseRequest, environment)).toMatchObject({
      status: 'skipped',
      code,
    });
  });

  it('requires the paid CLI opt-in and a bounded estimate', () => {
    expect(
      evaluateLiveRun({ ...baseRequest, allowPaid: false }, baseEnvironment),
    ).toMatchObject({ status: 'skipped', code: 'PAID_OPT_IN_REQUIRED' });
    expect(
      evaluateLiveRun(
        { ...baseRequest, estimatedMaxUsd: undefined },
        baseEnvironment,
      ),
    ).toMatchObject({ status: 'skipped', code: 'COST_UNKNOWN' });
    expect(
      evaluateLiveRun(
        { ...baseRequest, estimatedMaxUsd: 0.5 },
        baseEnvironment,
      ),
    ).toMatchObject({ status: 'skipped', code: 'USD_BUDGET_EXCEEDED' });
  });

  it('adds image and video quantity budgets', () => {
    expect(
      evaluateLiveRun(
        { ...baseRequest, capability: 'images', requestedImages: 1 },
        baseEnvironment,
      ),
    ).toMatchObject({ status: 'skipped', code: 'IMAGE_BUDGET_REQUIRED' });
    expect(
      evaluateLiveRun(
        {
          ...baseRequest,
          capability: 'images',
          requestedImages: 2,
        },
        { ...baseEnvironment, DUODUO_AI_LIVE_MAX_IMAGES: '1' },
      ),
    ).toMatchObject({ status: 'skipped', code: 'IMAGE_BUDGET_EXCEEDED' });
    expect(
      evaluateLiveRun(
        {
          ...baseRequest,
          capability: 'videos',
          requestedVideoSeconds: 3,
        },
        {
          ...baseEnvironment,
          DUODUO_AI_LIVE_MAX_VIDEO_SECONDS: '5',
        },
      ),
    ).toEqual({ status: 'allowed', maxUsd: 0.25, maxVideoSeconds: 5 });
  });
});
