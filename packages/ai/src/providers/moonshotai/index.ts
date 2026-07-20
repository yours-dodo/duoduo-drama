import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('moonshotai');

export type MoonshotAiProviderOptions = CompatibleProviderOptions;

export function moonshotAiProvider(options: MoonshotAiProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createMoonshotAiProvider = moonshotAiProvider;

export function moonshotAiModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as moonshotAiProviderDescriptor };
export type { CompatibleModelInput as MoonshotAiModelInput } from '../_shared/openai-compatible.js';
