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
  klingProvider,
  klingVideoModelRef,
} from '../../providers/kling/index.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { validateKlingVideoTaskId } from './index.js';

const fixtures = fileURLToPath(
  new URL('../../../test/fixtures/kling/videos/', import.meta.url),
);
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('kling-key'),
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
  const key = Buffer.from('kling-operation-proof');
  return createOperationCredentialVerifier({
    identityLifetime: 'cross-runtime',
    create: async (canonical) => ({
      status: 'created',
      proof: {
        keyId: 'kling-k1',
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

function runtime(now = () => 1784513000000) {
  const transport = createFixtureTransportDriver();
  const local = createLocalScopeAuthority({
    tenantId: 'kling-tenant',
    subjectId: 'kling-user',
    activeKeyId: 'scope-k1',
    keys: { 'scope-k1': Buffer.alloc(32, 9) },
  });
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://api-singapore.klingai.com', 'https://assets.example'],
    }),
    credentialOverridePolicy: { allow: () => true },
    credentialStore: createMemoryCredentialStore(),
    scopeAuthority: local.authority,
    generationOperationCodec: codec(),
    operationCredentialVerifier: verifier(),
    clock: { now },
  });
  ai.providers.register(klingProvider());
  return { ai, transport, scope: local.scope };
}

async function videoModel(
  ai: ReturnType<typeof createAi>,
  scope: ReturnType<typeof runtime>['scope'],
) {
  return ai.videos.models.require(klingVideoModelRef(), scope, {
    credentialOverride,
  });
}

function enqueueSuccess(
  transport: ReturnType<typeof createFixtureTransportDriver>,
) {
  transport.enqueue({
    expectedRequest: {
      method: 'POST',
      url: 'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
      headers: {
        authorization: 'Bearer kling-key',
        'content-type': 'application/json',
      },
      jsonBody: {
        contents: [
          { type: 'prompt', text: 'a paper dragon flies' },
          {
            type: 'first_frame',
            url: 'https://assets.example/first.png',
            id: 'image_1',
          },
          {
            type: 'last_frame',
            url: 'https://assets.example/last.png',
            id: 'image_2',
          },
          {
            type: 'refer_image',
            url: 'https://assets.example/reference.png',
            id: 'image_3',
          },
        ],
        settings: {
          resolution: '1080p',
          aspect_ratio: '16:9',
          duration: 8,
          audio: 'native',
          multi_shot: false,
        },
      },
    },
    status: 200,
    bodyChunks: [readFileSync(`${fixtures}/create.json`)],
  });
  for (const fixture of [
    'submitted.json',
    'processing.json',
    'succeeded.json',
  ]) {
    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://api-singapore.klingai.com/tasks?task_ids=kling-task-1',
        headers: { authorization: 'Bearer kling-key' },
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/${fixture}`)],
    });
  }
}

describe('Kling VIDEO 3.0 Omni tasks', () => {
  it('creates and polls text plus first/last/reference image generation', async () => {
    const { ai, transport, scope } = runtime();
    enqueueSuccess(transport);
    const result = await ai.videos.generate(
      await videoModel(ai, scope),
      {
        operation: 'generate',
        content: [
          { type: 'text', text: 'a paper dragon flies' },
          ...(['first_frame', 'last_frame', 'reference'] as const).map(
            (role, index) => ({
              type: 'image' as const,
              role,
              image: {
                mediaType: 'image/png',
                source: {
                  type: 'url' as const,
                  url: `https://assets.example/${index === 0 ? 'first' : index === 1 ? 'last' : 'reference'}.png`,
                },
              },
            }),
          ),
        ],
        durationSeconds: 8,
        resolution: '1080p',
        aspectRatio: '16:9',
        generateAudio: true,
      },
      { credentialOverride, pollIntervalMs: 0 },
    );
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'kling-task-1',
      usage: { generatedVideos: 1, generatedSeconds: 8 },
      outputs: [
        {
          type: 'video',
          video: {
            artifact: {
              mediaType: 'video/mp4',
              source: {
                type: 'url',
                url: 'https://assets.example/kling-result.mp4',
                expiresAt: 1787104920000,
              },
            },
            durationSeconds: 8,
            fps: 24,
            hasAudio: true,
            metadata: {
              providerOutputId: 'video-1',
              watermarkUrl: 'https://assets.example/kling-watermark.mp4',
              billing: [{ resource: 'video', quantity: 8, unit: 'second' }],
              requestId: 'req-poll-3',
            },
          },
        },
      ],
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it.each([
    [{ fps: 24 }, 'VIDEO_FPS_UNSUPPORTED'],
    [{ seed: 1 }, 'VIDEO_SEED_UNSUPPORTED'],
    [{ count: 2 }, 'VIDEO_OUTPUT_COUNT_INVALID'],
    [{ durationSeconds: 2 }, 'VIDEO_DURATION_UNSUPPORTED'],
    [{ durationSeconds: 16 }, 'VIDEO_DURATION_UNSUPPORTED'],
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

  it('rejects edit, video/audio inputs, base64 images, and extension fields', async () => {
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
            {
              type: 'image',
              role: 'reference',
              image: {
                mediaType: 'image/png',
                source: { type: 'base64', data: 'AA==' },
              },
            },
          ],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'KLING_VIDEO_RESOURCE_URL_REQUIRED' },
    });
    await expect(
      ai.videos.generate(
        model,
        { operation: 'generate', content: [{ type: 'text', text: 'options' }] },
        { credentialOverride, protocolOptions: { unsafe: true } as never },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'KLING_VIDEO_TASKS_OPTIONS_INVALID' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it('rejects unsafe task ids before query route resolution', async () => {
    expect(() => validateKlingVideoTaskId('../secret')).toThrowError(
      expect.objectContaining({ code: 'KLING_VIDEO_TASK_ID_INVALID' }),
    );
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      status: 200,
      bodyChunks: [
        Buffer.from(JSON.stringify({ code: 0, data: { id: '../secret' } })),
      ],
    });
    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'unsafe id' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'KLING_VIDEO_TASK_ID_INVALID' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it.each([
    ['failed.json', 'ContentPolicyViolation'],
    ['expired.json', 'KLING_VIDEO_TASK_EXPIRED'],
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
          content: [{ type: 'text', text: 'terminal' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({ status: 'failed', error: { code } });
    expect(transport.pendingCount()).toBe(0);
  });

  it('cancels locally while polling without a remote cancel route', async () => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/create.json`)],
    });
    transport.enqueue({
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/processing.json`)],
    });
    const controller = new AbortController();
    const pending = ai.videos.generate(
      await videoModel(ai, scope),
      { operation: 'generate', content: [{ type: 'text', text: 'cancel me' }] },
      { credentialOverride, pollIntervalMs: 50, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 5);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
    expect(transport.pendingCount()).toBe(0);
  });
});
