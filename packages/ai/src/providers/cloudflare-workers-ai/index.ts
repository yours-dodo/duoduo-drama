import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('cloudflare-workers-ai');

export type CloudflareWorkersAiProviderOptions = Omit<
  CompatibleProviderOptions,
  'accountId'
> &
  Readonly<{ accountId: string }>;

export function cloudflareWorkersAiProvider(
  options: CloudflareWorkersAiProviderOptions,
) {
  return createCompatibleProvider(descriptor, options);
}

export const createCloudflareWorkersAiProvider = cloudflareWorkersAiProvider;

export function cloudflareWorkersAiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as cloudflareWorkersAiProviderDescriptor };
export type { CompatibleModelInput as CloudflareWorkersAiModelInput } from '../_shared/openai-compatible.js';
