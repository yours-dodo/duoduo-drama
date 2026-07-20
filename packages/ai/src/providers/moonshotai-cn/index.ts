import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('moonshotai-cn');

export type MoonshotAiCnProviderOptions = CompatibleProviderOptions;

export function moonshotAiCnProvider(
  options: MoonshotAiCnProviderOptions = {},
) {
  return createCompatibleProvider(descriptor, options);
}

export const createMoonshotAiCnProvider = moonshotAiCnProvider;

export function moonshotAiCnModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as moonshotAiCnProviderDescriptor };
export type { CompatibleModelInput as MoonshotAiCnModelInput } from '../_shared/openai-compatible.js';
