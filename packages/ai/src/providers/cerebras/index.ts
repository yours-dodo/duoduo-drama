import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('cerebras');

export type CerebrasProviderOptions = CompatibleProviderOptions;

export function cerebrasProvider(options: CerebrasProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createCerebrasProvider = cerebrasProvider;

export function cerebrasModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as cerebrasProviderDescriptor };
export type { CompatibleModelInput as CerebrasModelInput } from '../_shared/openai-compatible.js';
