import { describe, expect, it } from 'vitest';
import { secret } from '../../auth/secret-value.js';
import type { AuthHttpRequest } from '../../auth/oauth.js';
import {
  createRadiusProvider,
  discoverRadiusGatewayConfig,
  parseRadiusGatewayConfig,
  radiusConfigDigest,
} from './index.js';

const encoder = new TextEncoder();
describe('Radius provider', () => {
  it('validates gateway configuration and maps model facts', () => {
    const config = parseRadiusGatewayConfig({
      baseUrl: 'https://api.radius.pi.dev/v1',
      cacheMaxAgeMs: 60_000,
      models: [
        {
          id: 'radius-pro',
          name: 'Radius Pro',
          reasoning: false,
          input: ['text', 'image', 'audio'],
          contextWindow: 200_000,
          max_tokens: 8192,
          cost: { input: 1.5, output: 4, cache_read: 0.2 },
        },
      ],
    });
    expect(config).toMatchObject({
      baseUrl: 'https://api.radius.pi.dev/v1',
      cacheMaxAgeMs: 60_000,
      models: [
        {
          id: 'radius-pro',
          input: ['text', 'image'],
          contextTokens: 200_000,
          maxOutputTokens: 8192,
          pricing: { rates: { input: 1.5, output: 4, cacheRead: 0.2 } },
        },
      ],
    });
    expect(radiusConfigDigest(config)).toMatch(/^[a-f0-9]{64}$/u);
    const provider = createRadiusProvider({
      baseUrl: config.baseUrl,
      models: config.models,
      oauth: false,
    });
    expect(provider.chat?.models[0]).toMatchObject({
      id: 'radius-pro',
      protocol: 'pi-messages',
      capabilities: { input: ['text', 'image'], reasoning: false },
      limits: { contextTokens: 200_000, maxOutputTokens: 8192 },
    });
    const binding = provider.chat!.transport;
    expect(
      binding.endpointForCredential?.(provider.chat!.models[0]!, {
        radiusBaseUrl: 'https://edge.radius.pi.dev/v2',
      }),
    ).toBe('https://edge.radius.pi.dev/v2/messages');
    expect(
      binding.derivedOriginPolicy?.resolve({
        radiusBaseUrl: 'https://edge.radius.pi.dev/v2',
      }),
    ).toEqual(['https://edge.radius.pi.dev']);
  });

  it('rejects an unbound config or credential endpoint origin', () => {
    expect(() =>
      parseRadiusGatewayConfig({
        baseUrl: 'https://evil.example/v1',
        models: [{ id: 'x' }],
      }),
    ).toThrow('origin is not allowed');
    const provider = createRadiusProvider({ models: [{ id: 'x' }] });
    expect(() =>
      provider.chat!.transport.endpointForCredential?.(
        provider.chat!.models[0]!,
        { radiusBaseUrl: 'https://evil.example/v1' },
      ),
    ).toThrow('origin is not allowed');
  });

  it('discovers /v1/config with the caller signal and secret authorization', async () => {
    const controller = new AbortController();
    let request: AuthHttpRequest | undefined;
    const authorization = secret('Bearer canary');
    const config = await discoverRadiusGatewayConfig(
      'https://radius.pi.dev',
      {
        signal: controller.signal,
        networkPolicy: { authorize: async () => {} },
        transport: {
          send: async (input) => {
            request = input;
            return {
              status: 200,
              headers: {},
              body: encoder.encode(
                JSON.stringify({
                  baseUrl: 'https://api.radius.pi.dev/v1',
                  models: [{ id: 'fixture' }],
                }),
              ),
            };
          },
        },
      },
      authorization,
    );
    expect(request).toMatchObject({
      method: 'GET',
      signal: controller.signal,
      headers: { authorization },
    });
    expect(request?.url.href).toBe('https://radius.pi.dev/v1/config');
    expect(config.models).toEqual([
      expect.objectContaining({ id: 'fixture', input: ['text'] }),
    ]);
  });
});
