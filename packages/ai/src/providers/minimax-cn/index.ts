import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('minimax-cn');

export type MinimaxCnProviderOptions = GatewayProviderOptions;
export type MinimaxCnModelInput = GatewayModelInput;

export function minimaxCnProvider(options: MinimaxCnProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createMinimaxCnProvider = minimaxCnProvider;

export function minimaxCnModelRef<
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

export { descriptor as minimaxCnProviderDescriptor };
