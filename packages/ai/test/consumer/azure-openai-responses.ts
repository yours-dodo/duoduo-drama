import { createAi, secret, type RequestCredentialOverride } from '@duoduo/ai';
import { createAzureOpenAiResponsesProvider } from '@duoduo/ai/providers/azure-openai-responses';
import { runAzureOpenAiResponses } from '@duoduo/ai/protocols/azure-openai-responses';
import { createAllowlistNetworkPolicy } from '@duoduo/ai/transport';
import { createFixtureTransportDriver } from '@duoduo/ai/testing';

const provider = createAzureOpenAiResponsesProvider({
  resourceName: 'fixture',
  models: [{ id: 'gpt-4.1-mini' }],
});
const ai = createAi({
  transport: createFixtureTransportDriver(),
  networkPolicy: createAllowlistNetworkPolicy({
    origins: ['https://fixture.openai.azure.com'],
  }),
  credentialOverridePolicy: { allow: () => true },
});
ai.providers.register(provider);

export async function compileAzureConsumer(): Promise<void> {
  const credentialOverride: RequestCredentialOverride = {
    type: 'api_key',
    secret: secret('fixture-only'),
    scheme: '',
  };
  const model = await ai.models.require(
    {
      providerInstanceId: provider.id,
      modelId: 'gpt-4.1-mini',
      protocol: 'azure-openai-responses',
    },
    {},
    { credentialOverride },
  );
  ai.stream(
    model,
    { messages: [] },
    {
      credentialOverride,
      sessionId: 'consumer-session',
      retry: false,
    },
  );
  void runAzureOpenAiResponses;
}
