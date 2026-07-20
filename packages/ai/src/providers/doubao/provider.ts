import { createHash } from 'node:crypto';

import type { ChatRequest, ProtocolTerminal } from '../../core/events.js';
import type { ModelDefinition, ModelRef } from '../../core/models.js';
import type { ProtocolEventSink, Provider } from '../../runtime/registry.js';
import {
  buildDoubaoCatalog,
  type DoubaoExplicitModelInput,
} from './catalog.js';
import { resolveDoubaoEndpoints, type DoubaoRegion } from './endpoints.js';
import { doubaoContractManifest } from './manifest.js';
import {
  createDoubaoImagesBinding,
  type DoubaoExplicitImageModelInput,
} from './images.js';
import {
  createDoubaoProtocolRunners,
  type DoubaoTextProtocol,
} from './profiles.js';

export interface DoubaoProviderOptions {
  readonly id?: string;
  readonly region?: DoubaoRegion;
  readonly baseUrl?: URL | string;
  readonly compatibilityMode?: 'responses' | 'chat-completions';
  readonly additionalModels?: readonly DoubaoExplicitModelInput[];
  readonly imageModels?: readonly DoubaoExplicitImageModelInput[];
}

export function doubaoProvider(options: DoubaoProviderOptions = {}): Provider {
  const id = options.id ?? 'doubao';
  const compatibilityMode = options.compatibilityMode ?? 'responses';
  const endpoints = resolveDoubaoEndpoints(options);
  const models = buildDoubaoCatalog({
    providerInstanceId: id,
    compatibilityMode,
    additionalModels: options.additionalModels,
  });
  const runners = createDoubaoProtocolRunners();
  const images = options.imageModels?.length
    ? createDoubaoImagesBinding({
        providerInstanceId: id,
        endpoints,
        models: options.imageModels,
      })
    : undefined;
  const endpointForModel = (model: Readonly<ModelDefinition>): string =>
    model.protocol === 'openai-chat-completions'
      ? endpoints.chatCompletionsUrl
      : endpoints.responsesUrl;
  return Object.freeze({
    id,
    kind: 'doubao',
    name: 'Volcengine Ark / Doubao',
    identity: Object.freeze({
      region: options.region ?? 'cn-beijing',
      origin: endpoints.origin,
      baseUrl: endpoints.baseUrl,
      compatibilityMode,
      catalog: JSON.stringify(
        models.map((model) => [
          model.id,
          model.upstreamModelId,
          model.protocol,
          model.protocolProfileId,
        ]),
      ),
      explicit: JSON.stringify(options.additionalModels ?? []),
      imageModels: JSON.stringify(options.imageModels ?? []),
    }),
    auth: Object.freeze({
      policyFingerprint:
        createHash('sha256')
          .update(
            JSON.stringify([
              'doubao',
              options.region ?? 'cn-beijing',
              endpoints.origin,
              endpoints.baseUrl,
              options.additionalModels ?? [],
              options.imageModels ?? [],
            ]),
          )
          .digest('base64url') + ':ARK_API_KEY',
    }),
    contractManifest: doubaoContractManifest,
    ...(images ? { images } : {}),
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
          request.model.protocol as DoubaoTextProtocol,
        );
        if (!runner)
          throw new Error(
            `unsupported Doubao protocol: ${request.model.protocol}`,
          );
        return runner(request, sink);
      },
    }),
  });
}

export const createDoubaoProvider = doubaoProvider;

export function doubaoModelRef<
  TProtocol extends DoubaoTextProtocol = 'openai-responses',
>(
  modelId = 'doubao-seed-1-6',
  protocol: TProtocol = 'openai-responses' as TProtocol,
  providerInstanceId = 'doubao',
): ModelRef<TProtocol> {
  return Object.freeze({ providerInstanceId, modelId, protocol });
}
