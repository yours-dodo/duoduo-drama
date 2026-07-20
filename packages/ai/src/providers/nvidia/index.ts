import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('nvidia');

export type NvidiaProviderOptions = CompatibleProviderOptions;

export function nvidiaProvider(options: NvidiaProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createNvidiaProvider = nvidiaProvider;

export function nvidiaModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as nvidiaProviderDescriptor };
export type { CompatibleModelInput as NvidiaModelInput } from '../_shared/openai-compatible.js';
