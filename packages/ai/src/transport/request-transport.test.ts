import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../index.js';
import { createFinalRequestTarget } from './request-transport.js';
import { createOpenAiProvider } from '../providers/openai/index.js';
import { createFixtureTransportDriver } from '../testing.js';

describe('bound request transport security', () => {
  it.each([
    'http://api.openai.com/v1/responses',
    'https://user:password@api.openai.com/v1/responses',
    'https://api.openai.com/v1/responses#fragment',
  ])('rejects an unsafe final request target: %s', (endpoint) => {
    expect(() =>
      createFinalRequestTarget({
        endpoint: new URL(endpoint),
        headers: {},
      }),
    ).toThrowError('final request target must be an absolute HTTPS URL');
  });

  it('denies credential overrides by default during model lookup', async () => {
    const ai = createAi();
    const provider = createOpenAiProvider();
    ai.providers.register(provider);

    await expect(
      ai.models.require(
        {
          providerInstanceId: provider.id,
          modelId: 'gpt-4.1-mini',
          protocol: 'openai-responses',
        },
        {},
        {
          credentialOverride: {
            type: 'api_key',
            secret: secret('sk-policy-canary'),
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'CREDENTIAL_OVERRIDE_DENIED',
      category: 'auth',
      message: 'request credential override is not allowed',
    });
  });

  it('authorizes the final target before dispatch and returns a redacted failure', async () => {
    const canary = 'sk-network-policy-canary';
    const transport = createFixtureTransportDriver();
    let authorizeCalls = 0;
    const ai = createAi({
      transport,
      networkPolicy: {
        authorize: async ({ url }) => {
          authorizeCalls += 1;
          expect(url.href).toBe('https://api.openai.com/v1/responses');
          throw new Error('network target denied');
        },
      },
      credentialOverridePolicy: { allow: () => true },
    });
    const provider = createOpenAiProvider();
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret(canary),
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      { messages: [] },
      { credentialOverride },
    );

    expect(authorizeCalls).toBe(1);
    expect(transport.requests()).toEqual([]);
    expect(response).toMatchObject({
      status: 'failed',
      error: {
        code: 'INTERNAL_ERROR',
        category: 'internal',
        message: 'AI provider failed internally',
      },
    });
    expect(JSON.stringify(response)).not.toContain(canary);
  });

  it('fails closed on case-insensitive protected header conflicts before dispatch', async () => {
    const transport = createFixtureTransportDriver();
    const ai = createAi({
      transport,
      networkPolicy: { authorize: async () => undefined },
      credentialOverridePolicy: { allow: () => true },
    });
    const openAi = createOpenAiProvider();
    const provider = {
      ...openAi,
      chat: {
        ...openAi.chat!,
        transport: {
          ...openAi.chat!.transport!,
          headers: {
            ...openAi.chat!.transport!.headers,
            Authorization: 'configured-value',
          },
        },
      },
    };
    ai.providers.register(provider);
    const credentialOverride = {
      type: 'api_key' as const,
      secret: secret('sk-conflict-canary'),
    };
    const model = await ai.models.require(
      {
        providerInstanceId: provider.id,
        modelId: 'gpt-4.1-mini',
        protocol: 'openai-responses',
      },
      {},
      { credentialOverride },
    );

    const response = await ai.complete(
      model,
      { messages: [] },
      { credentialOverride },
    );

    expect(response).toMatchObject({
      status: 'failed',
      error: {
        code: 'PROTECTED_HEADER_CONFLICT',
        category: 'invalid_request',
      },
    });
    expect(transport.requests()).toEqual([]);
  });
});
