import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createLocalScopeAuthority } from '../auth/node/local-scope.js';
import { secret } from '../auth/secret-value.js';
import type { ImageContent } from '../core/content.js';
import { createAi } from '../index.js';
import {
  openRouterImageModelRef,
  openRouterProvider,
} from '../providers/openrouter/index.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../testing.js';
import { createAllowlistNetworkPolicy } from '../transport/index.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('openrouter-key'),
  scheme: 'Bearer',
};

const mixedRequest = {
  model: 'google/gemini-2.5-flash-image',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Draw the first scene.' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,cmVmZXJlbmNl' },
        },
        { type: 'text', text: 'Then vary the lighting.' },
      ],
    },
  ],
  modalities: ['image', 'text'],
  stream: false,
};

function createRuntime() {
  const transport = createFixtureTransportDriver();
  const ai = createAi({
    transport,
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://openrouter.ai', 'https://assets.example'],
    }),
    credentialOverridePolicy: { allow: () => true },
  });
  ai.providers.register(openRouterProvider());
  return { ai, transport };
}

async function requireModel(ai: ReturnType<typeof createRuntime>['ai']) {
  return ai.images.models.require(
    openRouterImageModelRef(),
    {},
    { credentialOverride },
  );
}

function mixedInput() {
  return {
    content: [
      { type: 'text' as const, text: 'Draw the first scene.' },
      {
        type: 'image' as const,
        image: {
          type: 'image' as const,
          mediaType: 'image/png',
          source: { type: 'base64' as const, data: 'cmVmZXJlbmNl' },
        },
      },
      { type: 'text' as const, text: 'Then vary the lighting.' },
    ],
  };
}

async function mixedFixture() {
  return readFile(
    new URL(
      '../../test/fixtures/openrouter/images/mixed.json',
      import.meta.url,
    ),
  );
}

function enqueueMixed(
  transport: ReturnType<typeof createRuntime>['transport'],
  options: { chunkDelayMs?: number } = {},
) {
  return mixedFixture().then((body) => {
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          authorization: 'Bearer openrouter-key',
          'content-type': 'application/json',
        },
        jsonBody: mixedRequest,
      },
      status: 200,
      headers: { 'content-type': 'application/json' },
      bodyChunks: [body],
      ...options,
    });
  });
}

describe('images runtime', () => {
  it('rejects invalid image catalog descriptors at provider registration', () => {
    const base = openRouterProvider();
    const images = base.images!;
    const model = images.models[0]!;
    const protocol = images.protocols[0]!;
    const invalidBindings = [
      {
        name: 'provider mismatch',
        images: {
          ...images,
          models: [{ ...model, providerInstanceId: 'other' }],
        },
        message: 'image model providerInstanceId must match provider id',
      },
      {
        name: 'duplicate model reference',
        images: { ...images, models: [model, { ...model }] },
        message: 'image model references must be unique',
      },
      {
        name: 'missing profile',
        images: {
          ...images,
          models: [{ ...model, protocolProfileId: 'missing' }],
        },
        message: 'image model protocol profile not found',
      },
      {
        name: 'duplicate profile id',
        images: {
          ...images,
          protocols: [
            {
              ...protocol,
              profiles: { duplicate: { ...protocol.defaultProfile } },
            },
          ],
        },
        message: 'image protocol profile ids must be unique',
      },
      {
        name: 'non-positive limit',
        images: {
          ...images,
          models: [{ ...model, limits: { ...model.limits, maxOutputs: 0 } }],
        },
        message: 'image model limits must be positive integers',
      },
      {
        name: 'empty output formats',
        images: {
          ...images,
          models: [
            {
              ...model,
              capabilities: { ...model.capabilities, outputFormats: [] },
            },
          ],
        },
        message: 'image model output formats must not be empty',
      },
      {
        name: 'empty outputs',
        images: {
          ...images,
          models: [
            { ...model, capabilities: { ...model.capabilities, output: [] } },
          ],
        },
        message: 'image model outputs must not be empty',
      },
      {
        name: 'empty sizes',
        images: {
          ...images,
          models: [
            { ...model, capabilities: { ...model.capabilities, sizes: [] } },
          ],
        },
        message: 'image model sizes must not be empty',
      },
      {
        name: 'invalid input defaults',
        images: {
          ...images,
          models: [
            { ...model, inputDefaults: { ...model.inputDefaults, count: 2 } },
          ],
        },
        message: 'image model input defaults are invalid',
      },
      {
        name: 'direct model marked async',
        images: {
          ...images,
          models: [
            {
              ...model,
              capabilities: { ...model.capabilities, asyncOperation: true },
            },
          ],
        },
        message: 'direct image models must not enable asyncOperation',
      },
    ] as const;

    for (const invalid of invalidBindings) {
      const ai = createAi();
      expect(
        () => ai.providers.register({ ...base, images: invalid.images }),
        invalid.name,
      ).toThrow(invalid.message);
    }
  });

  it('generates ordered text and multiple images through an OpenRouter direct model', async () => {
    const { ai, transport } = createRuntime();
    await enqueueMixed(transport);
    const model = await requireModel(ai);

    const result = await ai.images.generate(model, mixedInput(), {
      credentialOverride,
    });

    expect(result).toMatchObject({
      status: 'completed',
      partial: false,
      responseId: 'gen-or-1',
      outputs: [
        { type: 'text', text: 'Here are the images.' },
        {
          type: 'image',
          image: {
            mediaType: 'image/png',
            source: { type: 'base64', data: 'aW1hZ2Ux' },
          },
        },
        {
          type: 'image',
          image: {
            mediaType: 'image/jpeg',
            source: { type: 'base64', data: 'aW1hZ2Uy' },
          },
        },
      ],
      usage: {
        inputTokens: 75,
        outputTokens: 20,
        cacheReadTokens: 20,
        cacheWriteTokens: 5,
      },
    });
    expect(result.cost).toMatchObject({ currency: 'USD', source: 'computed' });
    expect(result.cost?.total).toBeCloseTo(0.00007351666666666667, 12);
    expect(result.operation).toBeUndefined();
  });

  it('publishes a monotonic stream with one terminal event', async () => {
    const { ai, transport } = createRuntime();
    await enqueueMixed(transport);
    const model = await requireModel(ai);
    const stream = ai.images.stream(model, mixedInput(), {
      credentialOverride,
    });
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events[0]?.type).toBe('generation_start');
    expect(events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(events.at(-1)?.type).toBe('generation_end');
    expect(
      events.filter(
        (event) =>
          event.type.endsWith('_end') || event.type === 'generation_error',
      ),
    ).toHaveLength(1);
    expect(result.status).toBe('completed');
    await expect(stream.detach()).rejects.toMatchObject({
      code: 'OPERATION_NOT_AVAILABLE',
    });
  });

  it('rejects arbitrary protocol fields before transport', async () => {
    const { ai, transport } = createRuntime();
    const model = await requireModel(ai);
    const result = await ai.images.generate(
      model,
      { content: [{ type: 'text', text: 'draw' }] },
      {
        credentialOverride,
        protocolOptions: { arbitrary: true } as never,
      },
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'OPENROUTER_IMAGES_OPTIONS_INVALID' },
    });
    expect(transport.requests()).toHaveLength(0);
  });

  it('rejects unsupported count before transport', async () => {
    const { ai, transport } = createRuntime();
    const model = await requireModel(ai);
    const result = await ai.images.generate(
      model,
      {
        content: [{ type: 'text', text: 'draw' }],
        count: 2,
      },
      { credentialOverride },
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'IMAGE_OUTPUT_COUNT_INVALID' },
    });
    expect(transport.requests()).toHaveLength(0);
  });

  it('enforces base64 and URL resource limits before model transport', async () => {
    const { ai, transport } = createRuntime();
    const model = await requireModel(ai);
    const invalidBase64 = await ai.images.generate(
      model,
      {
        content: [
          {
            type: 'image',
            image: {
              type: 'image',
              mediaType: 'image/png',
              source: { type: 'base64', data: '***' },
            },
          },
        ],
      },
      { credentialOverride },
    );
    expect(invalidBase64).toMatchObject({
      status: 'failed',
      error: { code: 'IMAGE_BASE64_INVALID' },
    });

    transport.enqueue({
      expectedRequest: {
        method: 'GET',
        url: 'https://assets.example/reference.png',
      },
      status: 200,
      headers: { 'content-type': 'text/plain' },
      bodyChunks: [new TextEncoder().encode('not an image')],
    });
    const urlImage: ImageContent = {
      type: 'image',
      mediaType: 'image/png',
      source: { type: 'url', url: 'https://assets.example/reference.png' },
    };
    const invalidType = await ai.images.generate(
      model,
      {
        content: [{ type: 'image', image: urlImage }],
      },
      { credentialOverride },
    );
    expect(invalidType).toMatchObject({
      status: 'failed',
      error: { code: 'RESOURCE_CONTENT_TYPE_NOT_ALLOWED' },
    });
    expect(transport.requests()).toHaveLength(1);
  });

  it('returns a cancelled result when the caller aborts', async () => {
    const { ai, transport } = createRuntime();
    await enqueueMixed(transport, { chunkDelayMs: 50 });
    const model = await requireModel(ai);
    const controller = new AbortController();
    const stream = ai.images.stream(model, mixedInput(), {
      credentialOverride,
      signal: controller.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.type).toBe('generation_start');
    controller.abort('caller stopped');
    const result = await stream.result();
    expect(result).toMatchObject({
      status: 'cancelled',
      error: { category: 'cancelled' },
    });
  });

  it('enforces timeout as a cancelled terminal result', async () => {
    const { ai, transport } = createRuntime();
    await enqueueMixed(transport, { chunkDelayMs: 50 });
    const model = await requireModel(ai);
    const result = await ai.images.generate(model, mixedInput(), {
      credentialOverride,
      timeoutMs: 5,
    });
    expect(result).toMatchObject({
      status: 'cancelled',
      error: { code: 'IMAGE_GENERATION_TIMEOUT', category: 'cancelled' },
    });
  });

  it('preserves partial output when a later image is malformed', async () => {
    const { ai, transport } = createRuntime();
    transport.enqueue({
      status: 200,
      bodyChunks: [
        new TextEncoder().encode(
          JSON.stringify({
            id: 'partial-1',
            choices: [
              {
                message: {
                  content: 'partial text',
                  images: [
                    { image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
                    { image_url: { url: 'not-a-data-url' } },
                  ],
                },
              },
            ],
          }),
        ),
      ],
    });
    const model = await requireModel(ai);
    const result = await ai.images.generate(
      model,
      { content: [{ type: 'text', text: 'draw' }] },
      { credentialOverride },
    );
    expect(result).toMatchObject({
      status: 'failed',
      partial: true,
      outputs: [{ type: 'text', text: 'partial text' }, { type: 'image' }],
      error: { code: 'OPENROUTER_IMAGES_DATA_URL_INVALID' },
    });
  });

  it('rejects a different credential than the one bound to the handle', async () => {
    const { ai, transport } = createRuntime();
    const model = await requireModel(ai);
    const result = await ai.images.generate(
      model,
      { content: [{ type: 'text', text: 'draw' }] },
      {
        credentialOverride: {
          ...credentialOverride,
          secret: secret('different-key'),
        },
      },
    );
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'CREDENTIAL_OVERRIDE_MISMATCH' },
    });
    expect(transport.requests()).toHaveLength(0);
  });

  it('uses stored auth and fences a stale image handle', async () => {
    const store = createMemoryCredentialStore();
    const local = createLocalScopeAuthority({
      tenantId: 'tenant-images',
      subjectId: 'subject-images',
      credentialSlotId: 'primary',
    });
    const transport = createFixtureTransportDriver();
    const ai = createAi({
      credentialStore: store,
      scopeAuthority: local.authority,
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://openrouter.ai'],
      }),
    });
    ai.providers.register(openRouterProvider());
    await ai.auth.login('openrouter', 'api_key', local.scope, {
      promptSecret: async () => secret('stored-openrouter-key'),
    });
    const model = await ai.images.models.require(
      openRouterImageModelRef(),
      local.scope,
    );
    transport.enqueue({
      expectedRequest: {
        method: 'POST',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        headers: { authorization: 'Bearer stored-openrouter-key' },
      },
      status: 200,
      bodyChunks: [
        new TextEncoder().encode(
          JSON.stringify({
            id: 'stored-image',
            choices: [
              {
                message: {
                  images: [
                    { image_url: { url: 'data:image/png;base64,aW1hZ2U=' } },
                  ],
                },
              },
            ],
          }),
        ),
      ],
    });
    await expect(
      ai.images.generate(model, { content: [{ type: 'text', text: 'draw' }] }),
    ).resolves.toMatchObject({
      status: 'completed',
      responseId: 'stored-image',
    });

    await ai.auth.login('openrouter', 'api_key', local.scope, {
      promptSecret: async () => secret('replacement-key'),
    });
    await expect(
      ai.images.generate(model, { content: [{ type: 'text', text: 'draw' }] }),
    ).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'CREDENTIAL_HANDLE_STALE' },
    });
    expect(transport.requests()).toHaveLength(1);
  });

  it('rejects credential overrides when policy denies them', async () => {
    const transport = createFixtureTransportDriver();
    const ai = createAi({
      transport,
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://openrouter.ai'],
      }),
      credentialOverridePolicy: { allow: () => false },
    });
    ai.providers.register(openRouterProvider());
    await expect(
      ai.images.models.require(
        openRouterImageModelRef(),
        {},
        { credentialOverride },
      ),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_OVERRIDE_DENIED' });
    expect(transport.requests()).toHaveLength(0);
  });
});
