import {
  builtinProviderKinds,
  builtinProviders,
  getBuiltinInventory,
  type BuiltinProvidersResult,
} from '@duoduo/ai/providers/all';

export async function compileBuiltinProvidersConsumer(): Promise<BuiltinProvidersResult> {
  const result = await builtinProviders();
  void builtinProviderKinds;
  void getBuiltinInventory('self-hosted-generation');
  return result;
}
