import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('openrouter');

export type OpenRouterProviderOptions = GatewayProviderOptions;
export type OpenRouterModelInput = GatewayModelInput;

export function openRouterProvider(options: OpenRouterProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
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
