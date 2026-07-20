import {
  compatibleModelRef,
  createCompatibleProvider,
  requireCompatibleDescriptor,
  type CompatibleProviderOptions,
} from '../_shared/openai-compatible.js';

const descriptor = requireCompatibleDescriptor('xiaomi-token-plan-sgp');

export type XiaomiTokenPlanSgpProviderOptions = CompatibleProviderOptions;

export function xiaomiTokenPlanSgpProvider(
  options: XiaomiTokenPlanSgpProviderOptions = {},
) {
  return createCompatibleProvider(descriptor, options);
}

export const createXiaomiTokenPlanSgpProvider = xiaomiTokenPlanSgpProvider;

export function xiaomiTokenPlanSgpModelRef(
  modelId: string = descriptor.defaultModelId,
  providerInstanceId: string = descriptor.kind,
) {
  return compatibleModelRef(descriptor, modelId, providerInstanceId);
}

export { descriptor as xiaomiTokenPlanSgpProviderDescriptor };
export type { CompatibleModelInput as XiaomiTokenPlanSgpModelInput } from '../_shared/openai-compatible.js';
