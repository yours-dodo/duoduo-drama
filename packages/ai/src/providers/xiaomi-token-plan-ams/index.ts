import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('xiaomi-token-plan-ams');

export type XiaomiTokenPlanAmsProviderOptions = CompatibleProviderOptions;

export function xiaomiTokenPlanAmsProvider(
  options: XiaomiTokenPlanAmsProviderOptions = {},
) {
  return createCompatibleProvider(descriptor, options);
}

export const createXiaomiTokenPlanAmsProvider = xiaomiTokenPlanAmsProvider;

export function xiaomiTokenPlanAmsModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xiaomiTokenPlanAmsProviderDescriptor };
export type { CompatibleModelInput as XiaomiTokenPlanAmsModelInput } from '../_shared/openai-compatible.js';
