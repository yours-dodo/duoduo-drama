import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createLocalScopeAuthority } from '../../auth/node/local-scope.js';
import { secret } from '../../auth/secret-value.js';
import {
  createOperationCredentialVerifier,
  type GenerationOperationCodec,
  type GenerationOperationEnvelope,
} from '../../generation/index.js';
import { createAi } from '../../index.js';
import {
  doubaoProvider,
  doubaoVideoModelRef,
} from '../../providers/doubao/index.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { validateArkVideoTaskId } from './index.js';

const fixtures = fileURLToPath(
  new URL('../../../test/fixtures/doubao/seedance-2/', import.meta.url),
);
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('doubao-key'),
  scheme: 'Bearer',
};

function codec(): GenerationOperationCodec {
  return Object.freeze({
    persistence: 'cross-runtime',
    seal: async (envelope) => ({
      status: 'sealed',
      token: Buffer.from(JSON.stringify(envelope)).toString('base64url'),
    }),
    open: async (token) => {
      try {
        return {
          status: 'opened',
          envelope: JSON.parse(
            Buffer.from(token, 'base64url').toString('utf8'),
          ) as GenerationOperationEnvelope,
        };
      } catch {
        return { status: 'invalid' };
      }
    },
  });
}

function verifier() {
  const key = Buffer.from('doubao-operation-proof');
  return createOperationCredentialVerifier({
    identityLifetime: 'cross-runtime',
    create: async (canonical) => ({
      status: 'created',
      proof: {
        keyId: 'doubao-k1',
        digest: createHmac('sha256', key).update(canonical).digest('base64url'),
      },
    }),
    verify: async (canonical, proof) => ({
      status:
        createHmac('sha256', key).update(canonical).digest('base64url') ===
        proof.digest
          ? 'match'
          : 'mismatch',
    }),
  });
}

function runtime() {
  const transport = createFixtureTransportDriver();
  const local = createLocalScopeAuthority({
    tenantId: 'doubao-tenant',
    subjectId: 'doubao-user',
    activeKeyId: 'scope-k1',
    keys: { 'scope-k1': Buffer.alloc(32, 7) },
  });
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://ark.cn-beijing.volces.com', 'https://assets.example'],
    }),
    credentialOverridePolicy: { allow: () => true },
    credentialStore: createMemoryCredentialStore(),
    scopeAuthority: local.authority,
    generationOperationCodec: codec(),
    operationCredentialVerifier: verifier(),
  });
  ai.providers.register(
    doubaoProvider({
      videoModels: [
        {
          id: 'doubao-seedance-2-0',
          name: 'Doubao Seedance 2.0',
          upstreamModelId: 'doubao-seedance-2-0-260128',
        },
      ],
    }),
  );
  return { ai, transport, scope: local.scope };
}

async function videoModel(
  ai: ReturnType<typeof createAi>,
  scope: ReturnType<typeof runtime>['scope'],
) {
  return ai.videos.models.require(doubaoVideoModelRef(), scope, {
    credentialOverride,
  });
}

function enqueueSuccess(
  transport: ReturnType<typeof createFixtureTransportDriver>,
) {
  transport.enqueue({
    expectedRequest: {
      method: 'POST',
      url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
      headers: {
        authorization: 'Bearer doubao-key',
        'content-type': 'application/json',
      },
      jsonBody: {
        model: 'doubao-seedance-2-0-260128',
        content: [
          { type: 'text', text: 'a paper dragon flies' },
          {
            type: 'image_url',
            image_url: { url: 'https://assets.example/reference.png' },
            role: 'reference_image',
          },
          {
            type: 'video_url',
            video_url: { url: 'https://assets.example/reference.mp4' },
            role: 'reference_video',
          },
          {
            type: 'audio_url',
            audio_url: { url: 'https://assets.example/reference.mp3' },
            role: 'reference_audio',
          },
        ],
        duration: 8,
        resolution: '1080p',
        ratio: '16:9',
        generate_audio: true,
        seed: 42,
      },
    },
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyChunks: [readFileSync(`${fixtures}/create.json`)],
  });
  for (const fixture of ['queued.json', 'running.json', 'succeeded.json']) {
    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-seedance-2-task-1',
        headers: { authorization: 'Bearer doubao-key' },
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [readFileSync(`${fixtures}/${fixture}`)],
    });
  }
}

describe('Ark Seedance video tasks', () => {
  it('creates and polls an official multimodal Seedance 2.0 task', async () => {
    const { ai, transport, scope } = runtime();
    enqueueSuccess(transport);

    const result = await ai.videos.generate(
      await videoModel(ai, scope),
      {
        operation: 'generate',
        content: [
          { type: 'text', text: 'a paper dragon flies' },
          {
            type: 'image',
            role: 'reference',
            image: {
              mediaType: 'image/png',
              source: {
                type: 'url',
                url: 'https://assets.example/reference.png',
              },
            },
          },
          {
            type: 'video',
            role: 'reference',
            video: {
              mediaType: 'video/mp4',
              source: {
                type: 'url',
                url: 'https://assets.example/reference.mp4',
              },
              durationSeconds: 4,
            },
          },
          {
            type: 'audio',
            role: 'reference',
            audio: {
              mediaType: 'audio/mpeg',
              source: {
                type: 'url',
                url: 'https://assets.example/reference.mp3',
              },
            },
          },
        ],
        durationSeconds: 8,
        resolution: '1080p',
        aspectRatio: '16:9',
        generateAudio: true,
        seed: 42,
      },
      { credentialOverride, pollIntervalMs: 0 },
    );

    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'cgt-seedance-2-task-1',
      usage: {
        generatedVideos: 1,
        generatedSeconds: 8,
      },
      outputs: [
        {
          type: 'video',
          video: {
            artifact: {
              mediaType: 'video/mp4',
              source: {
                type: 'url',
                url: 'https://tos-cn-beijing.volces.com/seedance/result.mp4?X-Amz-Signature=redacted',
                expiresAt: 1784599240000,
              },
            },
            poster: {
              mediaType: 'image/jpeg',
              source: {
                type: 'url',
                url: 'https://tos-cn-beijing.volces.com/seedance/last-frame.jpeg?X-Amz-Signature=redacted',
                expiresAt: 1784599240000,
              },
            },
            durationSeconds: 8,
            fps: 24,
            hasAudio: true,
            metadata: {
              ratio: '16:9',
              resolution: '1080p',
              seed: 42,
              providerUsage: {
                completion_tokens: 2048,
                total_tokens: 2048,
              },
            },
          },
        },
      ],
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it('maps provider-neutral auto aspect ratio to adaptive', async () => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
        jsonBody: {
          model: 'doubao-seedance-2-0-260128',
          content: [{ type: 'text', text: 'adaptive framing' }],
          resolution: '720p',
          ratio: 'adaptive',
          generate_audio: false,
        },
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/create.json`)],
    });
    transport.enqueue({
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/succeeded.json`)],
    });
    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'adaptive framing' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it.each([
    [{ fps: 24 }, 'VIDEO_FPS_UNSUPPORTED'],
    [{ count: 2 }, 'VIDEO_OUTPUT_COUNT_INVALID'],
    [{ durationSeconds: 3 }, 'VIDEO_DURATION_UNSUPPORTED'],
    [{ durationSeconds: 16 }, 'VIDEO_DURATION_UNSUPPORTED'],
    [{ resolution: '4k' }, 'VIDEO_RESOLUTION_UNSUPPORTED'],
  ] as const)(
    'rejects unsupported controls before transport',
    async (patch, code) => {
      const { ai, transport, scope } = runtime();
      await expect(
        ai.videos.generate(
          await videoModel(ai, scope),
          {
            operation: 'generate',
            content: [{ type: 'text', text: 'unsupported control' }],
            ...patch,
          },
          { credentialOverride },
        ),
      ).resolves.toMatchObject({ status: 'failed', error: { code } });
      expect(transport.pendingCount()).toBe(0);
    },
  );

  it('rejects unsupported operations, roles, base64 media, and extension fields', async () => {
    const { ai, transport, scope } = runtime();
    const model = await videoModel(ai, scope);
    await expect(
      ai.videos.generate(
        model,
        { operation: 'edit', content: [{ type: 'text', text: 'edit' }] },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'VIDEO_OPERATION_UNSUPPORTED' },
    });
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'generate',
          content: [
            { type: 'text', text: 'wrong role' },
            {
              type: 'image',
              role: 'first_frame',
              image: {
                mediaType: 'image/png',
                source: {
                  type: 'url',
                  url: 'https://assets.example/frame.png',
                },
              },
            },
          ],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'VIDEO_IMAGE_ROLE_UNSUPPORTED' },
    });
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'generate',
          content: [
            { type: 'text', text: 'base64 rejected' },
            {
              type: 'audio',
              role: 'reference',
              audio: {
                mediaType: 'audio/mpeg',
                source: { type: 'base64', data: 'AA==' },
              },
            },
          ],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'ARK_VIDEO_RESOURCE_URL_REQUIRED' },
    });
    await expect(
      ai.videos.generate(
        model,
        { operation: 'generate', content: [{ type: 'text', text: 'options' }] },
        { credentialOverride, protocolOptions: { unsafe: true } as never },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'ARK_VIDEO_TASKS_OPTIONS_INVALID' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it('rejects unsafe task ids before poll route resolution', async () => {
    expect(() => validateArkVideoTaskId('../secret')).toThrowError(
      expect.objectContaining({ code: 'ARK_VIDEO_TASK_ID_INVALID' }),
    );
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      status: 200,
      bodyChunks: [Buffer.from(JSON.stringify({ id: '../secret' }))],
    });
    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'unsafe task id' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'ARK_VIDEO_TASK_ID_INVALID' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it.each([
    ['failed.json', 'ContentPolicyViolation'],
    ['expired.json', 'ARK_VIDEO_TASK_EXPIRED'],
  ] as const)('normalizes %s terminal states', async (fixture, code) => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/create.json`)],
    });
    transport.enqueue({
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/${fixture}`)],
    });
    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'terminal state' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({ status: 'failed', error: { code } });
    expect(transport.pendingCount()).toBe(0);
  });
});
