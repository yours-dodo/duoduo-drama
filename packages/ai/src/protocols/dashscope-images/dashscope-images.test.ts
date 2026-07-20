import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { qwenProvider } from '../../providers/qwen/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('dashscope-key'),
  scheme: 'Bearer',
};

describe('DashScope direct image protocol', () => {
  it('maps multimodal prompt content and image outputs', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
        headers: {
          authorization: 'Bearer dashscope-key',
          'content-type': 'application/json',
        },
        jsonBody: {
          model: 'wan2.6-image',
          input: {
            messages: [
              {
                role: 'user',
                content: [{ text: 'paint a lake' }],
              },
            ],
          },
          parameters: { n: 1, size: '1024*1024' },
        },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [
        Buffer.from(
          JSON.stringify({
            request_id: 'req-direct',
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: 'https://images.example/direct.png' }],
                  },
                },
              ],
            },
            usage: { image_count: 1 },
          }),
        ),
      ],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
    });
    ai.providers.register(qwenProvider({ region: 'cn-beijing' }));
    const model = await ai.images.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'wan2.6-image',
        protocol: 'dashscope-images',
      },
      {},
      { credentialOverride },
    );
    await expect(
      ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'paint a lake' }] },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'completed',
      responseId: 'req-direct',
      outputs: [{ type: 'image' }],
      usage: { generatedImages: 1 },
    });
  });
});
