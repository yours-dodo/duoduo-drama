import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('vercel-ai-gateway');

export type VercelAiGatewayProviderOptions = GatewayProviderOptions;
export type VercelAiGatewayModelInput = GatewayModelInput;

export function vercelAiGatewayProvider(
  options: VercelAiGatewayProviderOptions = {},
) {
  return createGatewayProvider(descriptor, options);
}

export const createVercelAiGatewayProvider = vercelAiGatewayProvider;

export function vercelAiGatewayModelRef<
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

export { descriptor as vercelAiGatewayProviderDescriptor };
