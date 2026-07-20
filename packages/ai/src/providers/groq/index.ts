import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('groq');

export type GroqProviderOptions = CompatibleProviderOptions;

export function groqProvider(options: GroqProviderOptions = {}) {
  return createCompatibleProvider(descriptor, options);
}

export const createGroqProvider = groqProvider;

export function groqModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as groqProviderDescriptor };
export type { CompatibleModelInput as GroqModelInput } from '../_shared/openai-compatible.js';
