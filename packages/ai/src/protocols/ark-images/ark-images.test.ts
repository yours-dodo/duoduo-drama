import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { doubaoProvider } from '../../providers/doubao/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('ark-key'),
  scheme: 'Bearer',
};
const fixtures = fileURLToPath(
  new URL('../../../test/fixtures/doubao/images/', import.meta.url),
);

function provider() {
  return doubaoProvider({
    imageModels: [
      {
        id: 'seedream-model',
        name: 'Seedream Model',
        upstream: { type: 'model', modelId: 'doubao-seedream-model-id' },
      },
      {
        id: 'seedream-endpoint',
        name: 'Seedream Endpoint',
        upstream: { type: 'endpoint', endpointId: 'ep-seedream-id' },
      },
    ],
  });
}

describe('Ark direct image protocol', () => {
  it.each([
    {
      modelId: 'seedream-model',
      upstream: 'doubao-seedream-model-id',
      responseFormat: 'url' as const,
      fixture: 'model-success.json',
      expectedOutput: { source: { type: 'url' } },
    },
    {
      modelId: 'seedream-endpoint',
      upstream: 'ep-seedream-id',
      responseFormat: 'base64' as const,
      fixture: 'endpoint-base64.json',
      expectedOutput: { source: { type: 'base64' } },
    },
  ])(
    'keeps explicit upstream identity in the body for $modelId',
    async ({ modelId, upstream, responseFormat, fixture, expectedOutput }) => {
      const transport = createFixtureTransportDriver();
      transport.enqueue({
        expectedRequest: {
          method: 'POST',
          url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
          headers: {
            authorization: 'Bearer ark-key',
            'content-type': 'application/json',
          },
          jsonBody: {
            model: upstream,
            prompt: 'paint a moon',
            image: 'data:image/png;base64,aW1hZ2U=',
            n: 1,
            size: '1024x1024',
            response_format: responseFormat === 'base64' ? 'b64_json' : 'url',
            seed: 7,
          },
        },
        status: 200,
        headers: { 'content-type': 'application/json' },
        bodyChunks: [readFileSync(`${fixtures}/${fixture}`)],
      });
      const ai = createAi({
        transport,
        networkPolicy: createAllowlistNetworkPolicy({
          origins: ['https://ark.cn-beijing.volces.com'],
        }),
        credentialOverridePolicy: { allow: () => true },
      });
      ai.providers.register(provider());
      const model = await ai.images.models.require(
        { providerInstanceId: 'doubao', modelId, protocol: 'ark-images' },
        {},
        { credentialOverride },
      );
      await expect(
        ai.images.generate(
          model,
          {
            content: [
              { type: 'text', text: 'paint a moon' },
              {
                type: 'image',
                image: {
                  mediaType: 'image/png',
                  source: {
                    type: 'base64',
                    data: 'aW1hZ2U=',
                  },
                },
              },
            ],
            count: 1,
            size: '1024x1024',
            seed: 7,
          },
          { credentialOverride, responseFormat },
        ),
      ).resolves.toMatchObject({
        status: 'completed',
        outputs: [{ type: 'image', image: expectedOutput }],
        usage: { generatedImages: 1 },
      });
    },
  );

  it('normalizes provider errors and never exposes an operation', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      },
      status: 400,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [readFileSync(`${fixtures}/error.json`)],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://ark.cn-beijing.volces.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(provider());
    const model = await ai.images.models.require(
      {
        providerInstanceId: 'doubao',
        modelId: 'seedream-model',
        protocol: 'ark-images',
      },
      {},
      { credentialOverride },
    );
    const result = await ai.images.generate(
      model,
      { content: [{ type: 'text', text: 'bad' }] },
      { credentialOverride },
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'InvalidParameter' },
    });
    expect('operation' in result).toBe(false);
  });
});
