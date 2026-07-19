import { describe, expect, it } from 'vitest';

import { createAi } from '../index.js';
import type { Provider } from './registry.js';
import { createFixtureTransportDriver } from '../testing.js';
import { createAllowlistNetworkPolicy } from '../transport/index.js';

function ambientProvider(): Provider {
  return {
    id: 'ambient-fixture',
    kind: 'ambient-fixture',
    name: 'Ambient Fixture',
    auth: {
      ambient: {
        resolve: async () => ({
          credentialInstanceId: 'ambient-account-1',
          credentialIdentityLifetime: 'cross-runtime',
          authorize: async () => ({ authorization: 'Signed fixture' }),
        }),
      },
    },
    chat: {
      models: [
        {
          id: 'model-a',
          upstreamModelId: 'upstream/model-a',
          name: 'Model A',
          providerInstanceId: 'ambient-fixture',
          protocol: 'fixture-ambient',
          protocolProfileId: 'default',
          capabilities: {
            input: ['text'],
            streaming: true,
            reasoning: false,
            toolCalling: false,
            parallelToolCalls: false,
            deferredTools: false,
            thinkingLevels: ['none'],
          },
          limits: { contextTokens: 1024, maxOutputTokens: 64 },
        },
      ],
      transport: {
        endpoint: 'https://ambient.example.test/v1',
        endpointForModel: (model) =>
          `https://ambient.example.test/v1/${encodeURIComponent(model.upstreamModelId)}`,
        credential: { headerName: 'authorization' },
      },
      runChat: async (request, sink) => {
        const response = await request.transport!.send({
          method: 'POST',
          body: '{}',
          responseMode: 'bytes',
          signal: request.signal,
        });
        expect(response.status).toBe(200);
        await sink.publish({
          type: 'text_start',
          itemId: 'text-0',
          contentIndex: 0,
        });
        await sink.publish({
          type: 'text_delta',
          itemId: 'text-0',
          contentIndex: 0,
          delta: 'ok',
        });
        await sink.publish({
          type: 'text_end',
          itemId: 'text-0',
          contentIndex: 0,
        });
        return { status: 'completed', finishReason: 'stop' };
      },
    },
  };
}

describe('provider ambient authorization', () => {
  it('binds a typed ambient authorizer and trusted model endpoint resolver', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://ambient.example.test/v1/upstream%2Fmodel-a',
        headers: { authorization: 'Signed fixture' },
        body: '{}',
      },
      status: 200,
      bodyChunks: [],
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://ambient.example.test'],
      }),
      ambientAuthPolicy: { allow: () => true },
    });
    ai.providers.register(ambientProvider());

    const model = await ai.models.require(
      {
        providerInstanceId: 'ambient-fixture',
        modelId: 'model-a',
        protocol: 'fixture-ambient',
      },
      {},
    );
    await expect(ai.complete(model, { messages: [] })).resolves.toMatchObject({
      status: 'completed',
      content: [{ type: 'text', text: 'ok' }],
    });
  });

  it('requires the host policy before using ambient credentials', async () => {
    const ai = createAi();
    ai.providers.register(ambientProvider());

    await expect(
      ai.models.require(
        {
          providerInstanceId: 'ambient-fixture',
          modelId: 'model-a',
          protocol: 'fixture-ambient',
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'AMBIENT_AUTH_DENIED' });
  });
});
