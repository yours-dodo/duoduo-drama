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
import { xAiProvider } from '../../providers/xai/index.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';

const fixtures = fileURLToPath(
  new URL('../../../test/fixtures/xai/videos/', import.meta.url),
);
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('xai-key'),
  scheme: 'Bearer',
};

function codec(onSeal?: (envelope: GenerationOperationEnvelope) => void) {
  const value: GenerationOperationCodec = Object.freeze({
    persistence: 'cross-runtime' as const,
    seal: async (envelope) => {
      onSeal?.(envelope);
      return {
        status: 'sealed' as const,
        token: Buffer.from(JSON.stringify(envelope)).toString('base64url'),
      };
    },
    open: async (token) => {
      try {
        return {
          status: 'opened' as const,
          envelope: JSON.parse(
            Buffer.from(token, 'base64url').toString('utf8'),
          ) as GenerationOperationEnvelope,
        };
      } catch {
        return { status: 'invalid' as const };
      }
    },
  });
  return value;
}

function verifier() {
  const key = Buffer.from('xai-operation-proof');
  return createOperationCredentialVerifier({
    identityLifetime: 'cross-runtime',
    create: async (canonical) => ({
      status: 'created',
      proof: {
        keyId: 'xai-k1',
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

function runtime(onSeal?: (envelope: GenerationOperationEnvelope) => void) {
  const transport = createFixtureTransportDriver();
  const local = createLocalScopeAuthority({
    tenantId: 'xai-tenant',
    subjectId: 'xai-user',
    activeKeyId: 'scope-k1',
    keys: { 'scope-k1': Buffer.alloc(32, 9) },
  });
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://api.x.ai'],
    }),
    credentialOverridePolicy: { allow: () => true },
    credentialStore: createMemoryCredentialStore(),
    scopeAuthority: local.authority,
    generationOperationCodec: codec(onSeal),
    operationCredentialVerifier: verifier(),
  });
  ai.providers.register(xAiProvider());
  return { ai, transport, scope: local.scope };
}

async function videoModel(
  ai: ReturnType<typeof createAi>,
  scope: ReturnType<typeof runtime>['scope'],
) {
  return ai.videos.models.require(
    {
      providerInstanceId: 'xai',
      modelId: 'grok-imagine-video',
      protocol: 'xai-videos',
    },
    scope,
    { credentialOverride },
  );
}

function enqueueSuccessfulVideo(
  transport: ReturnType<typeof createFixtureTransportDriver>,
) {
  transport.enqueue({
    expectedRequest: {
      method: 'POST',
      url: 'https://api.x.ai/v1/videos/generations',
      headers: {
        authorization: 'Bearer xai-key',
        'content-type': 'application/json',
      },
      jsonBody: {
        model: 'grok-imagine-video',
        prompt: 'a paper dragon flies',
        duration: 6,
      },
    },
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyChunks: [readFileSync(`${fixtures}/create.json`)],
  });
  transport.enqueue({
    expectedRequest: {
      method: 'GET',
      url: 'https://api.x.ai/v1/videos/video-request-1',
      headers: { authorization: 'Bearer xai-key' },
    },
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyChunks: [readFileSync(`${fixtures}/queued.json`)],
  });
  transport.enqueue({
    expectedRequest: {
      method: 'GET',
      url: 'https://api.x.ai/v1/videos/video-request-1',
      headers: { authorization: 'Bearer xai-key' },
    },
    status: 200,
    headers: { 'content-type': 'application/json' },
    bodyChunks: [readFileSync(`${fixtures}/completed.json`)],
  });
}

describe('xAI Grok Imagine videos', () => {
  it('creates, polls, and returns a temporary video with usage and cost', async () => {
    const { ai, transport, scope } = runtime();
    enqueueSuccessfulVideo(transport);

    const stream = ai.videos.stream(
      await videoModel(ai, scope),
      {
        operation: 'generate',
        content: [{ type: 'text', text: 'a paper dragon flies' }],
        durationSeconds: 6,
      },
      { credentialOverride, pollIntervalMs: 0 },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'generation_start' }),
        expect.objectContaining({
          type: 'generation_progress',
          phase: 'queued',
          progress: 0.25,
          operation: expect.any(Object),
        }),
        expect.objectContaining({ type: 'generation_output', outputIndex: 0 }),
        expect.objectContaining({ type: 'generation_end' }),
      ]),
    );
    expect(result).toMatchObject({
      status: 'completed',
      responseId: 'video-request-1',
      usage: { generatedVideos: 1, generatedSeconds: 6 },
      cost: { currency: 'USD' },
      outputs: [
        {
          type: 'video',
          video: {
            artifact: {
              mediaType: 'video/mp4',
              source: {
                type: 'url',
                url: 'https://cdn.x.ai/video/result.mp4?token=temporary',
                expiresAt: Date.parse('2026-07-20T12:00:00.000Z'),
              },
            },
            durationSeconds: 6,
            width: 1280,
            height: 720,
            fps: 24,
            hasAudio: true,
          },
        },
      ],
    });
    expect(result.cost?.outputSeconds).toBeCloseTo(0.3);
    expect(result.cost?.total).toBeCloseTo(0.3);
  });

  it('binds operation kind, input digest, and output specification into serialized claims', async () => {
    let sealed: GenerationOperationEnvelope | undefined;
    const { ai, transport, scope } = runtime((value) => {
      sealed = value;
    });
    enqueueSuccessfulVideo(transport);
    const stream = ai.videos.stream(
      await videoModel(ai, scope),
      {
        operation: 'generate',
        content: [{ type: 'text', text: 'a paper dragon flies' }],
        durationSeconds: 6,
      },
      { credentialOverride, pollIntervalMs: 0 },
    );
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    const progress = await iterator.next();
    expect(progress.value).toMatchObject({
      type: 'generation_progress',
      operation: expect.any(Object),
    });
    const operation = await stream.detach();
    await ai.videos.serializeOperation(operation);

    expect(sealed).toMatchObject({
      domain: 'videos',
      claimsVersion: 1,
      claims: {
        operationKind: 'generate',
        inputDigest: expect.stringMatching(/^[A-Za-z0-9_-]{20,}$/u),
        outputSpecification: {
          durationSeconds: 6,
          generateAudio: true,
          count: 1,
        },
      },
    });
    expect(JSON.stringify(sealed)).not.toContain('a paper dragon flies');
    await iterator.return?.();
  });

  it.each([
    { operation: 'edit' as const, route: 'edits' },
    { operation: 'extend' as const, route: 'extensions' },
  ])('maps $operation source-video input', async ({ operation, route }) => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: `https://api.x.ai/v1/videos/${route}`,
        jsonBody: {
          model: 'grok-imagine-video',
          prompt: 'continue the movement',
          video: { url: 'https://assets.example/source.mp4' },
        },
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/create.json`)],
    });
    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://api.x.ai/v1/videos/video-request-1',
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/completed.json`)],
    });
    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation,
          content: [
            { type: 'text', text: 'continue the movement' },
            {
              type: 'video',
              role: 'source',
              video: {
                mediaType: 'video/mp4',
                source: {
                  type: 'url',
                  url: 'https://assets.example/source.mp4',
                },
                durationSeconds: 5,
              },
            },
          ],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('maps an image first frame using the official generation schema', async () => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.x.ai/v1/videos/generations',
        jsonBody: {
          model: 'grok-imagine-video',
          prompt: 'bring the still frame to life',
          image: { url: 'https://assets.example/first-frame.png' },
        },
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/create.json`)],
    });
    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://api.x.ai/v1/videos/video-request-1',
      },
      status: 200,
      bodyChunks: [readFileSync(`${fixtures}/completed.json`)],
    });

    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [
            { type: 'text', text: 'bring the still frame to life' },
            {
              type: 'image',
              role: 'first_frame',
              image: {
                mediaType: 'image/png',
                source: {
                  type: 'url',
                  url: 'https://assets.example/first-frame.png',
                },
              },
            },
          ],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({ status: 'completed' });
  });

  it('rejects xAI video controls and roles not present in the pinned contract', async () => {
    const { ai, transport, scope } = runtime();
    const model = await videoModel(ai, scope);
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'unsupported fps' }],
          fps: 24,
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'VIDEO_FPS_UNSUPPORTED' },
    });
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'generate',
          content: [
            { type: 'text', text: 'unsupported reference role' },
            {
              type: 'image',
              role: 'reference',
              image: {
                mediaType: 'image/png',
                source: { type: 'url', url: 'https://assets.example/ref.png' },
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
    expect(transport.pendingCount()).toBe(0);
  });

  it('rejects invalid operation/input combinations before transport', async () => {
    const { ai, transport, scope } = runtime();
    const model = await videoModel(ai, scope);
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'edit',
          content: [{ type: 'text', text: 'edit without source' }],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'VIDEO_SOURCE_REQUIRED' },
    });
    await expect(
      ai.videos.generate(
        model,
        {
          operation: 'generate',
          content: [
            { type: 'text', text: 'generate' },
            {
              type: 'video',
              role: 'source',
              video: {
                mediaType: 'video/mp4',
                source: {
                  type: 'url',
                  url: 'https://assets.example/source.mp4',
                },
              },
            },
          ],
        },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'VIDEO_SOURCE_UNEXPECTED' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it('rejects an unsafe create request id before resolving a poll route', async () => {
    const { ai, transport, scope } = runtime();
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://api.x.ai/v1/videos/generations',
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [Buffer.from(JSON.stringify({ request_id: '../secret' }))],
    });

    await expect(
      ai.videos.generate(
        await videoModel(ai, scope),
        {
          operation: 'generate',
          content: [{ type: 'text', text: 'unsafe request id' }],
        },
        { credentialOverride, pollIntervalMs: 0 },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'XAI_VIDEO_REQUEST_ID_INVALID' },
    });
    expect(transport.pendingCount()).toBe(0);
  });

  it('rejects an image operation ref passed to video resume', async () => {
    const { ai, scope } = runtime();
    const imageOperation = await ai.images.parseOperation('abcdefghijklmnop');

    await expect(
      ai.videos.resume(
        imageOperation as unknown as import('../../videos/index.js').VideoOperationRef,
        { scope, credentialOverride },
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_REF_INVALID' });
  });

  it('normalizes failed and expired operation states', async () => {
    for (const [fixture, code] of [
      ['failed.json', 'content_policy'],
      ['expired.json', 'XAI_VIDEO_EXPIRED'],
    ] as const) {
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
            content: [{ type: 'text', text: 'unsafe' }],
          },
          { credentialOverride, pollIntervalMs: 0 },
        ),
      ).resolves.toMatchObject({ status: 'failed', error: { code } });
    }
  });
});
