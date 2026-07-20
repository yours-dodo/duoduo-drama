import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('xiaomi');

export type XiaomiProviderOptions = CompatibleProviderOptions;

export function xiaomiProvider(options: XiaomiProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createXiaomiProvider = xiaomiProvider;

export function xiaomiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xiaomiProviderDescriptor };
export type { CompatibleModelInput as XiaomiModelInput } from '../_shared/openai-compatible.js';
