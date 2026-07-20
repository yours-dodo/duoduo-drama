import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('cloudflare-ai-gateway');

export type CloudflareAiGatewayProviderOptions = GatewayProviderOptions &
  Readonly<{ accountId: string; gatewayId: string }>;
export type CloudflareAiGatewayModelInput = GatewayModelInput;

export function cloudflareAiGatewayProvider(
  options: CloudflareAiGatewayProviderOptions,
) {
  return createGatewayProvider(descriptor, options);
}

export const createCloudflareAiGatewayProvider = cloudflareAiGatewayProvider;

export function cloudflareAiGatewayModelRef<
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

export { descriptor as cloudflareAiGatewayProviderDescriptor };
