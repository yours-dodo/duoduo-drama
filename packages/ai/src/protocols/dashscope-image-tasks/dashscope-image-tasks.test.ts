import { describe, expect, it } from 'vitest';

import { secret } from '../../auth/secret-value.js';
import { createAi } from '../../index.js';
import { createOperationCredentialVerifier } from '../../generation/index.js';
import { qwenProvider } from '../../providers/qwen/index.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('dashscope-key'),
  scheme: 'Bearer',
};
const json = (value: unknown) => [Buffer.from(JSON.stringify(value))];

describe('DashScope image task protocol', () => {
  it('creates and polls wan2.6-image through a resumable operation', async () => {
    const transport = createFixtureTransportDriver();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation',
        headers: {
          authorization: 'Bearer dashscope-key',
          'content-type': 'application/json',
          'x-dashscope-async': 'enable',
        },
        jsonBody: {
          model: 'wan2.6-image',
          input: { prompt: 'a red panda' },
          parameters: { n: 1, size: '1024*1024', seed: 7 },
        },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: json({
        request_id: 'req-create',
        output: { task_id: 'task-1', task_status: 'PENDING' },
      }),
    });
    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://dashscope.aliyuncs.com/api/v1/tasks/task-1',
        headers: { authorization: 'Bearer dashscope-key' },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: json({
        request_id: 'req-poll',
        output: {
          task_id: 'task-1',
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://images.example/qwen.png' }],
        },
        usage: { image_count: 1 },
      }),
    });
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://dashscope.aliyuncs.com'],
      }),
      credentialOverridePolicy: { allow: () => true },
      operationCredentialVerifier: createOperationCredentialVerifier({
        identityLifetime: 'process-local',
        create: async () => ({
          status: 'created',
          proof: { keyId: 'k1', digest: 'proof' },
        }),
        verify: async () => ({ status: 'match' }),
      }),
    });
    ai.providers.register(qwenProvider({ region: 'cn-beijing' }));
    const model = await ai.images.models.require(
      {
        providerInstanceId: 'qwen',
        modelId: 'wan2.6-image@task',
        protocol: 'dashscope-image-tasks',
      },
      {},
      { credentialOverride },
    );
    const stream = ai.images.stream(
      model,
      {
        content: [{ type: 'text', text: 'a red panda' }],
        seed: 7,
      },
      { credentialOverride, pollIntervalMs: 1 },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'req-poll',
      outputs: [
        {
          type: 'image',
          image: {
            source: { type: 'url', url: 'https://images.example/qwen.png' },
          },
        },
      ],
      usage: { generatedImages: 1 },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'generation_progress',
          phase: 'queued',
          operation: expect.any(Object),
        }),
        expect.objectContaining({ type: 'generation_output' }),
      ]),
    );
  });

  it('rejects unsafe task ids before operation endpoint resolution', () => {
    const provider = qwenProvider({ region: 'cn-beijing' });
    const binding = provider.images!.protocols.find(
      ({ protocol }) => protocol === 'dashscope-image-tasks',
    )!;
    expect(() =>
      binding.operationMode === 'resumable'
        ? binding.resolveOperationEndpoint({
            action: 'poll',
            operation: { operationId: '../escape' } as never,
          } as never)
        : undefined,
    ).toThrow(/task id/i);
  });
});
