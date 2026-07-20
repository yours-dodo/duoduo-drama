import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('zai');

export type ZaiProviderOptions = CompatibleProviderOptions;

export function zaiProvider(options: ZaiProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createZaiProvider = zaiProvider;

export function zaiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as zaiProviderDescriptor };
export type { CompatibleModelInput as ZaiModelInput } from '../_shared/openai-compatible.js';
