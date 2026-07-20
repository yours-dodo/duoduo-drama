import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('zai-coding-cn');

export type ZaiCodingCnProviderOptions = CompatibleProviderOptions;

export function zaiCodingCnProvider(options: ZaiCodingCnProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createZaiCodingCnProvider = zaiCodingCnProvider;

export function zaiCodingCnModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as zaiCodingCnProviderDescriptor };
export type { CompatibleModelInput as ZaiCodingCnModelInput } from '../_shared/openai-compatible.js';
