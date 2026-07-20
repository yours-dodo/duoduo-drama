import { describe, expect, it } from 'vitest';

import {
  doubaoModelRef,
  doubaoProvider,
  resolveDoubaoEndpoints,
} from './index.js';

describe('Doubao provider', () => {
  it('uses the frozen Beijing Ark v3 endpoint by default', () => {
    expect(resolveDoubaoEndpoints({})).toEqual({
      origin: 'https://ark.cn-beijing.volces.com',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      responsesUrl: 'https://ark.cn-beijing.volces.com/api/v3/responses',
      chatCompletionsUrl:
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      imagesUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    });
    const provider = doubaoProvider();
    const model = provider.chat?.models[0];
    expect(model).toMatchObject({
      id: 'doubao-seed-1-6',
      protocol: 'openai-responses',
      protocolProfileId: 'doubao-openai-responses-default',
    });
    expect(provider.chat?.transport?.endpointForModel?.(model!)).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/responses',
    );
  });

  it('freezes compatibility mode and explicit model/endpoint identity in the catalog', () => {
    const provider = doubaoProvider({
      id: 'doubao-custom',
      compatibilityMode: 'chat-completions',
      baseUrl: new URL('https://ark.example.com/custom/api/v3/'),
      additionalModels: [
        {
          id: 'model-public',
          upstream: { type: 'model', modelId: 'doubao-model-upstream' },
          protocol: 'openai-responses',
          protocolProfileId: 'doubao-openai-responses-default',
        },
        {
          id: 'endpoint-public',
          upstream: { type: 'endpoint', endpointId: 'ep-upstream' },
          protocol: 'ark-responses',
          protocolProfileId: 'doubao-ark-responses-v3',
        },
      ],
    });
    expect(
      provider.chat?.models.map((model) => [
        model.id,
        model.upstreamModelId,
        model.protocol,
      ]),
    ).toEqual([
      ['doubao-seed-1-6', 'doubao-seed-1-6', 'openai-chat-completions'],
      ['model-public', 'doubao-model-upstream', 'openai-responses'],
      ['endpoint-public', 'ep-upstream', 'ark-responses'],
    ]);
    expect(
      provider.chat?.models.map((model) =>
        provider.chat?.transport?.endpointForModel?.(model),
      ),
    ).toEqual([
      'https://ark.example.com/custom/api/v3/chat/completions',
      'https://ark.example.com/custom/api/v3/responses',
      'https://ark.example.com/custom/api/v3/responses',
    ]);
    expect(
      doubaoModelRef('endpoint-public', 'ark-responses', 'doubao-custom'),
    ).toEqual({
      providerInstanceId: 'doubao-custom',
      modelId: 'endpoint-public',
      protocol: 'ark-responses',
    });
  });

  it('rejects inferred regions, duplicate IDs, profile mismatch, and route/header injection', () => {
    expect(() =>
      resolveDoubaoEndpoints({ region: 'us-east-1' as never }),
    ).toThrowError(/region/);
    expect(() =>
      doubaoProvider({
        additionalModels: [
          {
            id: 'doubao-seed-1-6',
            upstream: { type: 'model', modelId: 'override' },
            protocol: 'openai-responses',
            protocolProfileId: 'doubao-openai-responses-default',
          },
        ],
      }),
    ).toThrowError(/duplicate/);
    expect(() =>
      doubaoProvider({
        additionalModels: [
          {
            id: 'mismatch',
            upstream: { type: 'endpoint', endpointId: 'ep' },
            protocol: 'ark-responses',
            protocolProfileId: 'doubao-openai-responses-default',
          },
        ],
      }),
    ).toThrowError(/does not match/);
    expect(() =>
      doubaoProvider({
        additionalModels: [
          {
            id: 'injected',
            upstream: { type: 'endpoint', endpointId: 'ep' },
            protocol: 'ark-responses',
            protocolProfileId: 'doubao-ark-responses-v3',
            endpoint: 'https://evil.example',
            headers: { authorization: 'steal' },
          } as never,
        ],
      }),
    ).toThrowError(/cannot provide/);
  });
});
