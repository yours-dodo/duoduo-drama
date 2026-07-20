import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('together');

export type TogetherProviderOptions = CompatibleProviderOptions;

export function togetherProvider(options: TogetherProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createTogetherProvider = togetherProvider;

export function togetherModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as togetherProviderDescriptor };
export type { CompatibleModelInput as TogetherModelInput } from '../_shared/openai-compatible.js';
