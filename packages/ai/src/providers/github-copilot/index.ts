import {
  createGatewayProvider,
  gatewayModelRef,
  requireGatewayDescriptor,
  type GatewayModelInput,
  type GatewayProtocol,
  type GatewayProviderOptions,
} from '../_shared/multi-protocol.js';

const descriptor = requireGatewayDescriptor('github-copilot');

export type GitHubCopilotProviderOptions = GatewayProviderOptions;
export type GitHubCopilotModelInput = GatewayModelInput;

export function githubCopilotProvider(
  options: GitHubCopilotProviderOptions = {},
) {
  return createGatewayProvider(descriptor, options);
}

export const createGitHubCopilotProvider = githubCopilotProvider;

export function githubCopilotModelRef<
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

export { descriptor as githubCopilotProviderDescriptor };
