import { describe, expect, it } from 'vitest';

import type { VideoProviderBinding } from '../videos/contracts.js';
import type { VideoModelDefinition } from '../videos/models.js';
import { klingProvider } from '../providers/kling/index.js';
import { openRouterProvider } from '../providers/openrouter/index.js';
import {
  createAggregatorProvider,
  validateAggregatorCatalogFacts,
  validateAggregatorFallbackProfiles,
} from './aggregator-provider.js';

describe('aggregator provider contract', () => {
  it('exposes chat, images, and videos without allowing remote facts to change trusted bindings', () => {
    const openrouter = openRouterProvider({
      id: 'aggregator-a',
      baseUrl: 'https://aggregator.example/v1',
    });
    const kling = klingProvider({
      id: 'aggregator-a',
      baseUrl: 'https://aggregator.example/kling',
    });
    const provider = createAggregatorProvider({
      id: 'aggregator-a',
      kind: 'test-aggregator',
      name: 'Test Aggregator',
      capabilities: {
        chat: openrouter.chat,
        images: openrouter.images,
        videos: kling.videos,
      },
      remoteCatalogFacts: [
        {
          capability: 'videos',
          id: 'kling-video-3-0-omni',
          upstreamModelId: 'kling-3.0-omni',
          name: 'Kling VIDEO 3.0 Omni',
          publisher: 'Kuaishou',
          family: 'Kling VIDEO',
          availability: 'available',
          pricing: { currency: 'USD', perOutputSecond: 0.35 },
        },
      ],
      fallbackProfiles: [
        {
          id: 'chat-defaults',
          capability: 'chat',
          source: {
            providerInstanceId: 'aggregator-a',
            modelId: openrouter.chat!.models[0]!.id,
          },
          fallbacks: [],
        },
      ],
    });

    expect(provider.chat).toBe(openrouter.chat);
    expect(provider.images).toBe(openrouter.images);
    expect(provider.videos).toBe(kling.videos);
    expect(provider.videos!.protocols[0]!.endpoint).toBe(
      'https://aggregator.example/kling/omni-video/kling-3.0-omni',
    );
    expect(provider.remoteCatalogFacts).toHaveLength(1);
    expect(provider.fallbackProfiles).toHaveLength(1);
    expect(Object.isFrozen(provider)).toBe(true);
  });

  it.each([
    ['endpoint', 'https://evil.example'],
    ['baseUrl', 'https://evil.example'],
    ['headers', { authorization: 'Bearer stolen' }],
    ['auth', { scheme: 'Bearer' }],
    ['credential', { headerName: 'authorization' }],
    ['protocol', 'kling-video-tasks'],
    ['operationMode', 'direct'],
    ['operationActions', ['poll']],
    ['resolveEndpoint', 'catalog-owned-route'],
    ['resolveOperationEndpoint', 'catalog-owned-route'],
    ['route', '/tasks'],
    ['protocolProfileId', 'evil-profile'],
    ['profile', { id: 'evil-profile' }],
    ['compatibility', { wireVersion: 99 }],
  ])('rejects remote catalog field %s', (field, value) => {
    expect(() =>
      validateAggregatorCatalogFacts([
        {
          capability: 'videos',
          id: 'kling-v3',
          upstreamModelId: 'kling-v3',
          name: 'Kling V3',
          [field]: value,
        },
      ]),
    ).toThrow(/remote catalog/i);
  });

  it('rejects unsafe routing fields even when nested in provider metadata', () => {
    expect(() =>
      validateAggregatorCatalogFacts([
        {
          capability: 'videos',
          id: 'kling-v3',
          upstreamModelId: 'kling-v3',
          name: 'Kling V3',
          providerMetadata: {
            routing: { endpoint: 'https://evil.example' },
          },
        },
      ]),
    ).toThrow(/remote catalog field is forbidden: endpoint/i);
  });

  it('rejects duplicate remote model facts within one capability', () => {
    const fact = {
      capability: 'videos',
      id: 'kling-v3',
      upstreamModelId: 'kling-v3',
      name: 'Kling V3',
    } as const;
    expect(() => validateAggregatorCatalogFacts([fact, fact])).toThrow(
      /must be unique/i,
    );
  });

  it('accepts both transparent upstream wire and an aggregator-owned task wire', () => {
    const transparent = klingProvider({
      id: 'transparent-aggregator',
      baseUrl: 'https://aggregator.example/transparent',
    });
    const unified = createUnifiedVideoBinding('unified-aggregator');

    const transparentProvider = createAggregatorProvider({
      id: 'transparent-aggregator',
      kind: 'transparent-aggregator',
      name: 'Transparent Aggregator',
      capabilities: { videos: transparent.videos },
    });
    const unifiedProvider = createAggregatorProvider({
      id: 'unified-aggregator',
      kind: 'unified-aggregator',
      name: 'Unified Aggregator',
      capabilities: { videos: unified },
    });

    expect(transparentProvider.videos!.protocols[0]!.protocol).toBe(
      'kling-video-tasks',
    );
    expect(unifiedProvider.videos!.protocols[0]!.protocol).toBe(
      'aggregator-task-v1',
    );
    expect(unifiedProvider.videos!.protocols[0]!.endpoint).toBe(
      'https://aggregator.example/tasks',
    );
  });

  it('keeps fallback profiles visible and rejects implicit cross-provider fallback', () => {
    const provider = openRouterProvider({ id: 'aggregator-a' });
    const modelId = provider.chat!.models[0]!.id;

    expect(
      validateAggregatorFallbackProfiles(
        'aggregator-a',
        { chat: provider.chat },
        [
          {
            id: 'safe',
            capability: 'chat',
            source: { providerInstanceId: 'aggregator-a', modelId },
            fallbacks: [{ providerInstanceId: 'aggregator-a', modelId }],
          },
        ],
      ),
    ).toHaveLength(1);

    expect(() =>
      validateAggregatorFallbackProfiles(
        'aggregator-a',
        { chat: provider.chat },
        [
          {
            id: 'unsafe',
            capability: 'chat',
            source: { providerInstanceId: 'aggregator-a', modelId },
            fallbacks: [{ providerInstanceId: 'openrouter-direct', modelId }],
          },
        ],
      ),
    ).toThrow(/cross-provider fallback/i);
  });
});

function createUnifiedVideoBinding(
  providerInstanceId: string,
): VideoProviderBinding {
  const model: VideoModelDefinition<'aggregator-task-v1'> = Object.freeze({
    id: 'kling-v3',
    upstreamModelId: 'kling-v3',
    name: 'Kling V3 through Aggregator',
    providerInstanceId,
    publisher: 'Kuaishou',
    family: 'Kling VIDEO',
    protocol: 'aggregator-task-v1',
    protocolProfileId: 'aggregator-task-v1',
    capabilities: Object.freeze({
      operations: Object.freeze(['generate'] as const),
      inputModalities: Object.freeze(['text'] as const),
      imageRoles: Object.freeze([]),
      videoRoles: Object.freeze([]),
      audioInput: false,
      audioOutput: false,
      streamingPreviews: false,
      asyncOperation: true,
      seed: false,
      durationsSeconds: Object.freeze([5]),
      resolutions: Object.freeze(['720p']),
      aspectRatios: Object.freeze(['16:9']),
      frameRates: Object.freeze([24]),
      outputFormats: Object.freeze(['url'] as const),
    }),
    limits: Object.freeze({
      maxPromptCharacters: 4_000,
      maxReferenceImages: 1,
      maxReferenceImageBytes: 10_000_000,
      maxInputVideos: 1,
      maxInputVideoBytes: 100_000_000,
      maxInputVideoSeconds: 60,
      maxInputAudioBytes: 10_000_000,
      maxOutputs: 1,
    }),
    inputDefaults: Object.freeze({
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      fps: 24,
      count: 1,
    }),
  });
  return Object.freeze({
    catalogCompatibilityVersion: 'aggregator-video-catalog-v1',
    models: Object.freeze([model]),
    protocols: Object.freeze([
      Object.freeze({
        protocol: 'aggregator-task-v1',
        operationMode: 'resumable' as const,
        endpoint: 'https://aggregator.example/tasks',
        requestDefaults: Object.freeze({
          timeoutMs: 120_000,
          retry: false as const,
          responseFormat: 'url' as const,
          pollIntervalMs: 1_000,
          protocolOptions: Object.freeze({}),
        }),
        defaultProfile: Object.freeze({
          id: 'aggregator-task-v1',
          compatibility: Object.freeze({ wireVersion: 1 }),
          protocolDefaults: Object.freeze({}),
        }),
        operationCompatibilityVersion: 'aggregator-task-operation-v1',
        operationActions: Object.freeze(['poll'] as const),
        resolveOperationEndpoint: () =>
          'https://aggregator.example/tasks/task-1',
        loadAdapter: async () => {
          throw new Error('not needed by contract test');
        },
      }),
    ]),
  });
}
