import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('deepseek');

export type DeepseekProviderOptions = CompatibleProviderOptions;

export function deepseekProvider(options: DeepseekProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createDeepseekProvider = deepseekProvider;

export function deepseekModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as deepseekProviderDescriptor };
export type { CompatibleModelInput as DeepseekModelInput } from '../_shared/openai-compatible.js';
