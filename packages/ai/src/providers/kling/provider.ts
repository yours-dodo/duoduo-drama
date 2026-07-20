import {
  createKlingVideoTasksAdapter,
  validateKlingVideoTaskId,
} from '../../protocols/kling-video-tasks/index.js';
import type { Provider } from '../../runtime/registry.js';
import type {
  ResumableVideoProtocolBinding,
  VideoOperationEndpointContext,
  VideoProviderBinding,
} from '../../videos/contracts.js';
import type { VideoModelRef } from '../../videos/models.js';
import { klingApiKeyCredential, klingAuthPolicyFingerprint } from './auth.js';
import {
  buildKlingVideoCatalog,
  type KlingVideoModelInput,
} from './catalog.js';
import { resolveKlingEndpoints } from './endpoints.js';
import { klingContractManifest } from './manifest.js';
import { klingVideoProfiles } from './profiles.js';

export interface KlingProviderOptions {
  readonly id?: string;
  readonly baseUrl?: URL | string;
  readonly videoModels?: readonly KlingVideoModelInput[];
}

export function klingProvider(options: KlingProviderOptions = {}): Provider {
  const id = options.id ?? 'kling';
  const endpoints = resolveKlingEndpoints(options);
  const models = buildKlingVideoCatalog({
    providerInstanceId: id,
    models: options.videoModels,
  });
  const protocol: ResumableVideoProtocolBinding<'kling-video-tasks'> =
    Object.freeze({
      protocol: 'kling-video-tasks',
      operationMode: 'resumable',
      endpoint: endpoints.omniVideoCreateUrl,
      headers: Object.freeze({ 'content-type': 'application/json' }),
      credential: klingApiKeyCredential,
      retrySafety: Object.freeze({ mode: 'before-dispatch-only' as const }),
      requestDefaults: Object.freeze({
        timeoutMs: 900_000,
        retry: false,
        responseFormat: 'url' as const,
        pollIntervalMs: 2_000,
        protocolOptions: Object.freeze({}),
      }),
      defaultProfile: klingVideoProfiles['kling-video-3-0-omni-v2'],
      operationCompatibilityVersion: 'kling-video-tasks-operation-v2',
      operationActions: Object.freeze(['poll'] as const),
      resolveOperationEndpoint: (
        context: VideoOperationEndpointContext<'kling-video-tasks'>,
      ) =>
        endpoints.taskQueryUrl(
          validateKlingVideoTaskId(context.operation.operationId),
        ),
      loadAdapter: async () => createKlingVideoTasksAdapter(),
    });
  const videos: VideoProviderBinding = Object.freeze({
    catalogCompatibilityVersion: 'kling-videos-v2',
    models,
    protocols: Object.freeze([protocol]),
  });
  const modelIdentity = JSON.stringify(
    models.map((model) => [
      model.id,
      model.upstreamModelId,
      model.protocol,
      model.protocolProfileId,
    ]),
  );
  return Object.freeze({
    id,
    kind: 'kling',
    name: 'KlingAI Open Platform',
    identity: Object.freeze({
      origin: endpoints.origin,
      baseUrl: endpoints.baseUrl,
      modelIdentity,
    }),
    auth: Object.freeze({
      policyFingerprint: klingAuthPolicyFingerprint({
        providerInstanceId: id,
        baseUrl: endpoints.baseUrl,
        modelIdentity,
      }),
    }),
    contractManifest: klingContractManifest,
    videos,
  });
}

export const createKlingProvider = klingProvider;

export function klingVideoModelRef(
  modelId = 'kling-video-3-0-omni',
  providerInstanceId = 'kling',
): VideoModelRef<'kling-video-tasks'> {
  return Object.freeze({
    providerInstanceId,
    modelId,
    protocol: 'kling-video-tasks',
  });
}
