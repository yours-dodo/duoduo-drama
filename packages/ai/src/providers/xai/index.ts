import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('xai');

export type XAiProviderOptions = CompatibleProviderOptions;

export function xAiProvider(options: XAiProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createXAiProvider = xAiProvider;

export function xAiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xAiProviderDescriptor };
export type { CompatibleModelInput as XAiModelInput } from '../_shared/openai-compatible.js';
