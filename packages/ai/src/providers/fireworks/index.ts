import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('fireworks');

export type FireworksProviderOptions = GatewayProviderOptions;
export type FireworksModelInput = GatewayModelInput;

export function fireworksProvider(options: FireworksProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createFireworksProvider = fireworksProvider;

export function fireworksModelRef<
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

export { descriptor as fireworksProviderDescriptor };
