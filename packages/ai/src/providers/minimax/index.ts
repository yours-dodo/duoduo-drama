import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('minimax');

export type MinimaxProviderOptions = GatewayProviderOptions;
export type MinimaxModelInput = GatewayModelInput;

export function minimaxProvider(options: MinimaxProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createMinimaxProvider = minimaxProvider;

export function minimaxModelRef<
  TProtocol extends GatewayProtocol = 'anthropic-messages',
>(
  modelId: string = descriptor.defaultModelId,
  protocol: TProtocol = 'anthropic-messages' as TProtocol,
  providerInstanceId: string = descriptor.kind,
) {
  return gatewayModelRef(
    descriptor.kind,
    modelId,
    protocol,
    providerInstanceId,
  );
}

export { descriptor as minimaxProviderDescriptor };
