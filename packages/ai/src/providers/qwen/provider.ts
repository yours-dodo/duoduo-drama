import { createHash } from 'node:crypto';

import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ModelDefinition, ModelRef } from '../../core/models.js';
import type { ProtocolEventSink, Provider } from '../../runtime/registry.js';
import {
  appendPath,
  resolveQwenEndpoints,
  type QwenEndpointMode,
  type QwenRegion,
} from './endpoints.js';
import { buildQwenCatalog, type QwenAdditionalModelInput } from './catalog.js';
import { qwenContractManifest } from './manifest.js';
import {
  createQwenImagesBinding,
  type QwenAdditionalImageModelInput,
} from './images.js';
import {
  createQwenProtocolRunners,
  requireQwenProfile,
  type QwenProtocolPreference,
} from './profiles.js';

export interface QwenProviderOptions {
  readonly id?: string;
  readonly region: QwenRegion;
  readonly endpointMode?: QwenEndpointMode;
  readonly workspaceId?: string;
  readonly baseUrl?: URL | string;
  readonly protocolPreference?: QwenProtocolPreference;
  readonly additionalModels?: readonly QwenAdditionalModelInput[];
  readonly additionalImageModels?: readonly QwenAdditionalImageModelInput[];
}

export function qwenProvider(options: QwenProviderOptions): Provider {
  const id = options.id ?? 'qwen';
  const protocolPreference =
    options.protocolPreference ?? 'openai-chat-completions';
  const endpoints = resolveQwenEndpoints(options);
  const models = buildQwenCatalog({
    providerInstanceId: id,
    protocolPreference,
    additionalModels: options.additionalModels,
  });
  const runners = createQwenProtocolRunners();
  const images = createQwenImagesBinding({
    providerInstanceId: id,
    endpoints,
    ...(options.additionalImageModels
      ? { additionalModels: options.additionalImageModels }
      : {}),
  });
  const endpointForModel = (model: Readonly<ModelDefinition>): string => {
    switch (model.protocol as QwenProtocolPreference) {
      case 'openai-chat-completions':
        return appendPath(endpoints.compatibleBaseUrl, 'chat/completions');
      case 'openai-responses':
        return appendPath(endpoints.compatibleBaseUrl, 'responses');
      case 'anthropic-messages':
        return appendPath(endpoints.anthropicBaseUrl, 'v1/messages');
      case 'dashscope': {
        const profile = requireQwenProfile(model.protocolProfileId);
        if (profile.protocol !== 'dashscope' || !profile.route)
          throw new Error(`Qwen model ${model.id} has no curated native route`);
        return appendPath(
          endpoints.nativeBaseUrl,
          profile.route === 'text-generation'
            ? 'services/aigc/text-generation/generation'
            : 'services/aigc/multimodal-generation/generation',
        );
      }
    }
  };

  return Object.freeze({
    id,
    kind: 'qwen',
    name: 'Alibaba Cloud Model Studio / Qwen',
    identity: Object.freeze({
      region: options.region,
      endpointMode: options.endpointMode ?? 'shared',
      workspaceId: options.workspaceId ?? '',
      origin: endpoints.origin,
      protocolPreference,
      catalog: JSON.stringify(
        models.map((model) => [
          model.id,
          model.upstreamModelId,
          model.protocol,
          model.protocolProfileId,
        ]),
      ),
    }),
    auth: Object.freeze({
      policyFingerprint:
        createHash('sha256')
          .update(
            JSON.stringify([
              'qwen',
              options.region,
              options.endpointMode ?? 'shared',
              options.workspaceId ?? '',
              endpoints.origin,
            ]),
          )
          .digest('base64url') + ':DASHSCOPE_API_KEY',
    }),
    contractManifest: qwenContractManifest,
    images,
    chat: Object.freeze({
      models,
      transport: Object.freeze({
        endpoint: endpointForModel(models[0]!),
        endpointForModel,
        headers: Object.freeze({ 'content-type': 'application/json' }),
        credential: Object.freeze({
          headerName: 'authorization',
          defaultScheme: 'Bearer',
        }),
      }),
      runChat: async (
        request: ChatRequest,
        sink: ProtocolEventSink,
      ): Promise<ProtocolTerminal> => {
        const runner = runners.get(
          request.model.protocol as QwenProtocolPreference,
        );
        if (!runner)
          throw new Error(
            `unsupported Qwen protocol: ${request.model.protocol}`,
          );
        return runner(request, sink);
      },
    }),
  });
}

export const createQwenProvider = qwenProvider;

export function qwenModelRef<
  TProtocol extends QwenProtocolPreference = 'openai-chat-completions',
>(
  modelId = 'qwen-plus',
  protocol: TProtocol = 'openai-chat-completions' as TProtocol,
  providerInstanceId = 'qwen',
): ModelRef<TProtocol> {
  return Object.freeze({ providerInstanceId, modelId, protocol });
}
