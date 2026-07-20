import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';
import { createOpenRouterImagesBinding } from './images.js';

const descriptor = requireGatewayDescriptor('openrouter');

export interface OpenRouterProviderOptions extends GatewayProviderOptions {
  readonly imageModels?: readonly import('./images.js').OpenRouterImageModelInput[];
}
export type OpenRouterModelInput = GatewayModelInput;

export function openRouterProvider(options: OpenRouterProviderOptions = {}) {
  const provider = createGatewayProvider(descriptor, options);
  const imageBinding = createOpenRouterImagesBinding({
    providerInstanceId: provider.id,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.imageModels ? { additionalModels: options.imageModels } : {}),
  });
  return Object.freeze({
    ...provider,
    images: imageBinding,
    contractManifest: Object.freeze({
      ...provider.contractManifest!,
      bindings: Object.freeze([
        ...provider.contractManifest!.bindings,
        Object.freeze({
          capability: 'images' as const,
          protocol: 'openrouter-images',
          profileIds: Object.freeze(['openrouter-images-v1']),
          authSchemes: Object.freeze(['api-key']),
          endpointBranchIds: Object.freeze(['chat-completions']),
          requestFixtureIds: Object.freeze(['mixed']),
          streamFixtureIds: Object.freeze([]),
          errorFixtureIds: Object.freeze([]),
          sources: Object.freeze([
            Object.freeze({
              kind: 'pi' as const,
              locator: 'vendor/pi/packages/ai/src/api/openrouter-images.ts',
            }),
          ]),
        }),
      ]),
    }),
  });
}

export const createOpenRouterProvider = openRouterProvider;

export function openRouterModelRef<
  TProtocol extends GatewayProtocol = 'openai-chat-completions',
>(
  modelId: string = descriptor.defaultModelId,
  protocol: TProtocol = 'openai-chat-completions' as TProtocol,
  providerInstanceId: string = descriptor.kind,
) {
  return gatewayModelRef(
    descriptor.kind,
    modelId,
    protocol,
    providerInstanceId,
  );
}

export { descriptor as openRouterProviderDescriptor };

export {
  createOpenRouterImagesBinding,
  openRouterDefaultImageModelId,
  openRouterImageModelRef,
} from './images.js';
export type { OpenRouterImageModelInput } from './images.js';
