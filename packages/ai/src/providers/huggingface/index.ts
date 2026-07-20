import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('huggingface');

export type HuggingfaceProviderOptions = CompatibleProviderOptions;

export function huggingfaceProvider(options: HuggingfaceProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createHuggingfaceProvider = huggingfaceProvider;

export function huggingfaceModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as huggingfaceProviderDescriptor };
export type { CompatibleModelInput as HuggingfaceModelInput } from '../_shared/openai-compatible.js';
