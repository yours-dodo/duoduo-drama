import { describe, expect, it } from 'vitest';

import { createAi, secret } from '../index.js';
import {
  bindRequestTransport,
  createFinalRequestTarget,
} from './request-transport.js';
import { createOpenAiProvider } from '../providers/openai/index.js';
import { createFixtureTransportDriver } from '../testing.js';

describe('bound request transport resource limits', () => {
  it('rejects an oversized static request before dispatch', async () => {
    let dispatched = false;
    const transport = bindRequestTransport({
      target: createFinalRequestTarget({
        endpoint: new URL('https://api.example.com/v1/chat'),
        headers: {},
        limits: { maxRequestBytes: 3 },
      }),
      driver: {
        send: async () => {
          dispatched = true;
          return {
            status: 200,
            headers: {},
            body: { async *[Symbol.asyncIterator]() {} },
          };
        },
      },
      networkPolicy: { authorize: async () => undefined },
    });

    await expect(
      transport.send({
        method: 'POST',
        body: 'four',
        responseMode: 'bytes',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'TRANSPORT_REQUEST_TOO_LARGE' });
    expect(dispatched).toBe(false);
  });

  it('enforces the final response byte limit while streaming', async () => {
    const transport = bindRequestTransport({
      target: createFinalRequestTarget({
        endpoint: new URL('https://api.example.com/v1/chat'),
        headers: {},
        limits: { maxResponseBytes: 4 },
      }),
      driver: {
        send: async () => ({
          status: 200,
          headers: {},
          body: {
            async *[Symbol.asyncIterator]() {
              yield new TextEncoder().encode('abc');
              yield new TextEncoder().encode('de');
            },
          },
        }),
      },
      networkPolicy: { authorize: async () => undefined },
    });

    const response = await transport.send({
      method: 'GET',
      responseMode: 'stream',
      signal: new AbortController().signal,
    });
    const consume = async () => {
      for await (const chunk of response.body) {
        expect(chunk).toBeInstanceOf(Uint8Array);
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: 'TRANSPORT_RESPONSE_TOO_LARGE',
    });
  });

  it('uses the smaller error-response limit for non-success status codes', async () => {
    const transport = bindRequestTransport({
      target: createFinalRequestTarget({
        endpoint: new URL('https://api.example.com/v1/chat'),
        headers: {},
        limits: { maxResponseBytes: 100, maxErrorBytes: 4 },
      }),
      driver: {
        send: async () => ({
          status: 400,
          headers: {},
          body: {
            async *[Symbol.asyncIterator]() {
              yield new TextEncoder().encode('abcde');
            },
          },
        }),
      },
      networkPolicy: { authorize: async () => undefined },
    });

    const response = await transport.send({
      method: 'GET',
      responseMode: 'stream',
      signal: new AbortController().signal,
    });

    await expect(async () => {
      for await (const chunk of response.body)
        expect(chunk).toBeInstanceOf(Uint8Array);
    }).rejects.toMatchObject({ code: 'TRANSPORT_RESPONSE_TOO_LARGE' });
  });

  it('discards redirect bodies and refuses to replay streaming request bodies', async () => {
    let attempts = 0;
    let discardCalls = 0;
    const transport = bindRequestTransport({
      target: createFinalRequestTarget({
        endpoint: new URL('https://api.example.com/v1/chat'),
        headers: {},
      }),
      driver: {
        send: async () => {
          attempts += 1;
          return {
            status: 307,
            headers: { location: '/v1/redirected' },
            body: {
              [Symbol.asyncIterator]() {
                return {
                  next: async () => ({ done: true, value: undefined }),
                  return: async () => {
                    discardCalls += 1;
                    return { done: true, value: undefined };
                  },
                };
              },
            },
          };
        },
      },
      networkPolicy: { authorize: async () => undefined },
      redirect: 'same-origin',
    });

    await expect(
      transport.send({
        method: 'POST',
        body: new ReadableStream<Uint8Array>(),
        responseMode: 'stream',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'REDIRECT_NOT_ALLOWED' });
    expect(attempts).toBe(1);
    expect(discardCalls).toBe(1);
  });
});

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
