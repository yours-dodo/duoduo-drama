import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createLocalScopeAuthority } from '../auth/node/local-scope.js';
import { secret } from '../auth/secret-value.js';
import type { JsonValue } from '../core/content.js';
import { AiRuntimeError } from '../core/errors.js';
import {
  createOperationCredentialVerifier,
  type GenerationOperationCodec,
} from '../generation/index.js';
import { createAi } from '../index.js';
import type { Provider } from '../runtime/registry.js';
import {
  createFixtureTransportDriver,
  createMemoryCredentialStore,
} from '../testing.js';
import { createAllowlistNetworkPolicy } from '../transport/index.js';
import type {
  ImageProtocolTerminal,
  ResumableImageProtocolAdapter,
} from './contracts.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('operation-key'),
  scheme: 'Bearer',
};

function operationCodec(): GenerationOperationCodec {
  return Object.freeze({
    persistence: 'cross-runtime' as const,
    seal: async (envelope) => ({
      status: 'sealed' as const,
      token: Buffer.from(JSON.stringify(envelope)).toString('base64url'),
    }),
    open: async (token) => {
      try {
        return {
          status: 'opened' as const,
          envelope: JSON.parse(
            Buffer.from(token, 'base64url').toString('utf8'),
          ) as never,
        };
      } catch {
        return { status: 'invalid' as const };
      }
    },
  });
}

function credentialVerifier() {
  const key = Buffer.from('operation-proof-key');
  return createOperationCredentialVerifier({
    identityLifetime: 'cross-runtime',
    create: async (canonical) => ({
      status: 'created',
      proof: {
        keyId: 'test-k1',
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

function provider(
  adapter: ResumableImageProtocolAdapter<'test-image-tasks'>,
): Provider {
  return {
    id: 'test-images',
    kind: 'test-images',
    name: 'Test Images',
    identity: { endpoint: 'https://images.example/v1' },
    chat: {
      models: [],
      transport: {
        endpoint: 'https://images.example/v1/chat',
        credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
      },
      runChat: async () => {
        throw new Error('unused');
      },
    },
    images: {
      catalogCompatibilityVersion: 'test-images-v1',
      models: [
        {
          id: 'test-image@task',
          upstreamModelId: 'test-image',
          name: 'Test Image Task',
          providerInstanceId: 'test-images',
          protocol: 'test-image-tasks',
          protocolProfileId: 'default',
          capabilities: {
            textToImage: true,
            referenceImages: 'none',
            streamingPreviews: false,
            seed: false,
            output: ['image'],
            outputFormats: ['url'],
            sizes: ['1024x1024'],
            asyncOperation: true,
          },
          limits: {
            maxPromptCharacters: 4_000,
            maxReferenceImages: 1,
            maxReferenceImageBytes: 1_000_000,
            maxOutputs: 1,
          },
          inputDefaults: { count: 1, size: '1024x1024' },
          requestDefaults: { responseFormat: 'url' },
        },
      ],
      protocols: [
        {
          protocol: 'test-image-tasks',
          operationMode: 'resumable',
          operationCompatibilityVersion: '1',
          operationActions: ['poll', 'cancel'],
          endpoint: 'https://images.example/v1/tasks',
          credential: { headerName: 'authorization', defaultScheme: 'Bearer' },
          retrySafety: 'idempotent',
          defaultProfile: { id: 'default', compatibility: {} },
          resolveOperationEndpoint: ({ action, operation }) =>
            `https://images.example/v1/tasks/${encodeURIComponent(operation.operationId)}${
              action === 'cancel' ? '/cancel' : ''
            }`,
          loadAdapter: async () => adapter,
        },
      ],
    },
  };
}

function adapter(): ResumableImageProtocolAdapter<'test-image-tasks'> {
  const contract = {
    parseOptions: (input: unknown) =>
      (input ?? {}) as Readonly<Record<string, JsonValue>>,
    mergeOptions: (
      layers: readonly (Readonly<Record<string, JsonValue>> | undefined)[],
    ) => Object.assign({}, ...layers.filter(Boolean)),
    parseCompatibility: (input: unknown) =>
      (input ?? {}) as Readonly<Record<string, JsonValue>>,
  };
  return {
    id: 'test-image-tasks',
    operationMode: 'resumable',
    contract,
    parseOperationState: (input) => input as JsonValue | undefined,
    run: async (_request, sink) => {
      await sink.setOperation({
        operationId: 'task-1',
        operationState: { cursor: 'created' },
      });
      return new Promise<ImageProtocolTerminal>(() => undefined);
    },
    resume: async (_request, sink) => {
      await sink.publish({
        type: 'generation_output',
        outputIndex: 0,
        output: {
          type: 'image',
          image: {
            mediaType: 'image/png',
            source: { type: 'url', url: 'https://images.example/result.png' },
          },
        },
      });
      return { status: 'completed', responseId: 'task-1' };
    },
    cancel: async () => undefined,
  };
}

describe('resumable image operations', () => {
  it('detaches, serializes, parses, and resumes across runtimes', async () => {
    const codec = operationCodec();
    const verifier = credentialVerifier();
    const scopeKey = Buffer.alloc(32, 7);
    const createRuntime = () => {
      const transport = createFixtureTransportDriver();
      const local = createLocalScopeAuthority({
        tenantId: 'tenant-operation',
        subjectId: 'subject-operation',
        activeKeyId: 'scope-k1',
        keys: { 'scope-k1': scopeKey },
      });
      const ai = createAi({
        credentialStore: createMemoryCredentialStore(),
        scopeAuthority: local.authority,
        transport,
        networkPolicy: createAllowlistNetworkPolicy({
          origins: ['https://images.example'],
        }),
        credentialOverridePolicy: { allow: () => true },
        generationOperationCodec: codec,
        operationCredentialVerifier: verifier,
      });
      ai.providers.register(provider(adapter()));
      return { ai, scope: local.scope };
    };

    const firstRuntime = createRuntime();
    const first = firstRuntime.ai;
    const model = await first.images.models.require(
      {
        providerInstanceId: 'test-images',
        modelId: 'test-image@task',
        protocol: 'test-image-tasks',
      },
      firstRuntime.scope,
      { credentialOverride },
    );
    const stream = first.images.stream(
      model,
      { content: [{ type: 'text', text: 'draw' }] },
      { credentialOverride },
    );
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'generation_start' },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'generation_progress', operation: expect.any(Object) },
    });
    const operation = await stream.detach();
    await expect(stream.result()).resolves.toMatchObject({
      status: 'detached',
      operation,
    });
    expect(String(operation)).toBe('[REDACTED]');
    expect(JSON.stringify(operation)).toBe('"[REDACTED]"');
    expect(Object.keys(operation)).toEqual(['version']);
    const serialized = await first.images.serializeOperation(operation);

    const secondRuntime = createRuntime();
    const second = secondRuntime.ai;
    const parsed = await second.images.parseOperation(serialized);
    await expect(
      second.images.serializeOperation(parsed),
    ).rejects.toMatchObject({
      code: 'OPERATION_REF_RUNTIME_MISMATCH',
    });
    const resumed = await second.images.resume(parsed, {
      scope: secondRuntime.scope,
      credentialOverride,
    });
    await expect(resumed.result()).resolves.toMatchObject({
      status: 'completed',
      responseId: 'task-1',
      outputs: [{ type: 'image' }],
    });
  });

  it('rejects inconsistent resumable model and operation descriptors', () => {
    const valid = provider(adapter());
    const model = valid.images!.models[0]!;
    const binding = valid.images!.protocols[0]!;
    const invalidModel = {
      ...valid,
      images: {
        ...valid.images!,
        models: [
          {
            ...model,
            capabilities: { ...model.capabilities, asyncOperation: false },
          },
        ],
      },
    };
    expect(() => {
      const ai = createAi();
      ai.providers.register(invalidModel);
    }).toThrow(/resumable image models must enable asyncOperation/);

    const invalidActions = {
      ...valid,
      images: {
        ...valid.images!,
        protocols: [
          {
            ...binding,
            operationActions: ['poll', 'poll'] as const,
          },
        ],
      },
    };
    expect(() => {
      const ai = createAi();
      ai.providers.register(invalidActions);
    }).toThrow(/operation actions/);
  });

  it.each([
    {
      name: 'duplicate setOperation',
      run: async (
        _request: Parameters<
          ResumableImageProtocolAdapter<'test-image-tasks'>['run']
        >[0],
        sink: Parameters<
          ResumableImageProtocolAdapter<'test-image-tasks'>['run']
        >[1],
      ) => {
        await sink.setOperation({ operationId: 'task-1' });
        await sink.setOperation({ operationId: 'task-2' });
        return { status: 'completed' as const };
      },
    },
    {
      name: 'poll before setOperation',
      run: async (
        _request: Parameters<
          ResumableImageProtocolAdapter<'test-image-tasks'>['run']
        >[0],
        sink: Parameters<
          ResumableImageProtocolAdapter<'test-image-tasks'>['run']
        >[1],
      ) => {
        await sink.operationTransport('poll');
        return { status: 'completed' as const };
      },
    },
  ])('normalizes $name as a protocol violation', async ({ run }) => {
    const ai = createAi({
      transport: createFixtureTransportDriver(),
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://images.example'],
      }),
      credentialOverridePolicy: { allow: () => true },
      operationCredentialVerifier: credentialVerifier(),
    });
    ai.providers.register(provider({ ...adapter(), run }));
    const model = await ai.images.models.require(
      {
        providerInstanceId: 'test-images',
        modelId: 'test-image@task',
        protocol: 'test-image-tasks',
      },
      {},
      { credentialOverride },
    );
    await expect(
      ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'draw' }] },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: expect.objectContaining({
        code: 'IMAGE_PROTOCOL_VIOLATION',
      }) as AiRuntimeError,
    });
  });

  it('rejects a create terminal before the adapter sets an operation', async () => {
    const invalid = adapter();
    const ai = createAi({
      transport: createFixtureTransportDriver(),
      networkPolicy: createAllowlistNetworkPolicy({
        origins: ['https://images.example'],
      }),
      credentialOverridePolicy: { allow: () => true },
      operationCredentialVerifier: credentialVerifier(),
    });
    ai.providers.register(
      provider({
        ...invalid,
        run: async () => ({ status: 'completed' }),
      }),
    );
    const model = await ai.images.models.require(
      {
        providerInstanceId: 'test-images',
        modelId: 'test-image@task',
        protocol: 'test-image-tasks',
      },
      {},
      { credentialOverride },
    );
    await expect(
      ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'draw' }] },
        { credentialOverride },
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      error: expect.objectContaining({
        code: 'IMAGE_PROTOCOL_VIOLATION',
      }) as AiRuntimeError,
    });
  });
});
