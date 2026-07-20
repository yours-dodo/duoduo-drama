import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('kimi-coding');

export type KimiCodingProviderOptions = GatewayProviderOptions;
export type KimiCodingModelInput = GatewayModelInput;

export function kimiCodingProvider(options: KimiCodingProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createKimiCodingProvider = kimiCodingProvider;

export function kimiCodingModelRef<
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

export { descriptor as kimiCodingProviderDescriptor };
