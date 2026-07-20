import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { xAiProvider } from '../../providers/xai/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const fixtures = fileURLToPath(
  new URL('../../../test/fixtures/xai/images/', import.meta.url),
);
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('xai-key'),
  scheme: 'Bearer',
};

function runtime() {
  const transport = createFixtureTransportDriver();
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://api.x.ai'],
    }),
    credentialOverridePolicy: { allow: () => true },
  });
  ai.providers.register(xAiProvider());
  return { ai, transport };
}

async function imageModel(ai: ReturnType<typeof createAi>) {
  return ai.images.models.require(
    {
      providerInstanceId: 'xai',
      modelId: 'grok-imagine-image',
      protocol: 'xai-images',
    },
    {},
    { credentialOverride },
  );
}

describe('xAI Grok Imagine images', () => {
  it('generates a direct image with the shared provider credential', async () => {
    const { ai, transport } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.x.ai/v1/images/generations',
        headers: {
          authorization: 'Bearer xai-key',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'grok-imagine-image',
          prompt: 'paint a moon',
          n: 1,
          response_format: 'url',
          aspect_ratio: '1:1',
        },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [readFileSync(`${fixtures}/generate-success.json`)],
    });

    const result = await ai.images.generate(
      await imageModel(ai),
      {
        content: [{ type: 'text', text: 'paint a moon' }],
        size: '1024x1024',
      },
      { credentialOverride },
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'img-response-1',
      usage: { generatedImages: 1 },
      outputs: [
        {
          type: 'image',
          image: {
            mediaType: 'image/webp',
            source: {
              type: 'url',
              url: 'https://cdn.x.ai/generated/moon.webp',
            },
          },
        },
      ],
    });
    expect('operation' in result).toBe(false);
  });

  it('routes reference-image edits separately and normalizes base64 output', async () => {
    const { ai, transport } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.x.ai/v1/images/edits',
        headers: {
          authorization: 'Bearer xai-key',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'grok-imagine-image',
          prompt: 'make it blue',
          image: 'data:image/png;base64,aW1hZ2U=',
          n: 1,
          response_format: 'base64',
        },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [readFileSync(`${fixtures}/edit-base64.json`)],
    });

    await expect(
      ai.images.generate(
        await imageModel(ai),
        {
          content: [
            { type: 'text', text: 'make it blue' },
            {
              type: 'image',
              image: {
                mediaType: 'image/png',
                source: { type: 'base64', data: 'aW1hZ2U=' },
              },
            },
          ],
        },
        { credentialOverride, responseFormat: 'base64' },
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      outputs: [
        {
          type: 'image',
          image: {
            mediaType: 'image/png',
            source: { type: 'base64', data: 'ZWRpdGVkLWltYWdl' },
          },
        },
      ],
    });
  });

  it('rejects unsupported seed before dispatch and normalizes provider errors', async () => {
    const { ai, transport } = runtime();
    const model = await imageModel(ai);
    await expect(
      ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'seeded' }], seed: 7 },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'IMAGE_SEED_UNSUPPORTED' },
    });
    expect(transport.pendingCount()).toBe(0);

    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.x.ai/v1/images/generations',
      },
      status: 400,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [readFileSync(`${fixtures}/error.json`)],
    });
    await expect(
      ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'bad' }] },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'invalid_prompt', category: 'invalid_request' },
    });
  });
});
