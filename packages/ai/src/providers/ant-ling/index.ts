import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('ant-ling');

export type AntLingProviderOptions = CompatibleProviderOptions;

export function antLingProvider(options: AntLingProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createAntLingProvider = antLingProvider;

export function antLingModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as antLingProviderDescriptor };
export type { CompatibleModelInput as AntLingModelInput } from '../_shared/openai-compatible.js';
