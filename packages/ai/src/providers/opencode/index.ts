import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('opencode');

export type OpenCodeProviderOptions = GatewayProviderOptions;
export type OpenCodeModelInput = GatewayModelInput;

export function openCodeProvider(options: OpenCodeProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createOpenCodeProvider = openCodeProvider;

export function openCodeModelRef<
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

export { descriptor as openCodeProviderDescriptor };
