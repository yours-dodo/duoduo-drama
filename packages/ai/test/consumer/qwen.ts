import {
  createDashScopeAdapter,
  dashScopeContract,
  type DashScopeProtocolOptions,
} from '@duoduo/ai/protocols/dashscope';
import {
  qwenModelRef,
  qwenProvider,
  resolveQwenEndpoints,
  type QwenProviderOptions,
} from '@duoduo/ai/providers/qwen';

const providerOptions: QwenProviderOptions = {
  region: 'cn-beijing',
  protocolPreference: 'dashscope',
};
const protocolOptions: DashScopeProtocolOptions = {
  enableThinking: true,
};

void qwenProvider(providerOptions);
void qwenModelRef('qwen-plus', 'dashscope');
void resolveQwenEndpoints(providerOptions);
void createDashScopeAdapter();
void dashScopeContract;
void protocolOptions;
