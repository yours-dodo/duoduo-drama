import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('xiaomi-token-plan-cn');

export type XiaomiTokenPlanCnProviderOptions = CompatibleProviderOptions;

export function xiaomiTokenPlanCnProvider(
  options: XiaomiTokenPlanCnProviderOptions = {},
) {
  return createCompatibleProvider(descriptor, options);
}

export const createXiaomiTokenPlanCnProvider = xiaomiTokenPlanCnProvider;

export function xiaomiTokenPlanCnModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xiaomiTokenPlanCnProviderDescriptor };
export type { CompatibleModelInput as XiaomiTokenPlanCnModelInput } from '../_shared/openai-compatible.js';
