import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('opencode-go');

export type OpenCodeGoProviderOptions = GatewayProviderOptions;
export type OpenCodeGoModelInput = GatewayModelInput;

export function openCodeGoProvider(options: OpenCodeGoProviderOptions = {}) {
  return createGatewayProvider(descriptor, options);
}

export const createOpenCodeGoProvider = openCodeGoProvider;

export function openCodeGoModelRef<
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

export { descriptor as openCodeGoProviderDescriptor };
