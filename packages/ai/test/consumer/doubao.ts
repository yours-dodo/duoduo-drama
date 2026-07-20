import {
  arkResponsesContract,
  createArkResponsesAdapter,
  type ArkResponsesCompatibility,
} from '@duoduo/ai/protocols/ark-responses';
import {
  doubaoModelRef,
  doubaoProvider,
  resolveDoubaoEndpoints,
  type DoubaoProviderOptions,
  type DoubaoUpstream,
} from '@duoduo/ai/providers/doubao';

const providerOptions: DoubaoProviderOptions = {
  region: 'cn-beijing',
  compatibilityMode: 'responses',
};
const upstream: DoubaoUpstream = {
  type: 'endpoint',
  endpointId: 'ep-example',
};
const compatibility: ArkResponsesCompatibility = {
  wireVersion: 'ark-v3',
  thinkingField: 'thinking.type',
  supportsPreviousResponseId: true,
  supportsFunctionTools: true,
};

void doubaoProvider(providerOptions);
void doubaoModelRef('doubao-seed-1-6', 'openai-responses');
void resolveDoubaoEndpoints(providerOptions);
void createArkResponsesAdapter({ compatibility });
void arkResponsesContract;
void upstream;
