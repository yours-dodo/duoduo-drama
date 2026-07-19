import {
  createAi,
  secret,
  type AiContext,
  type RequestCredentialOverride,
} from '@duoduo/ai';
import { createOpenAiProvider } from '@duoduo/ai/providers/openai';
import { createAllowlistNetworkPolicy } from '@duoduo/ai/transport';
import { createFixtureTransportDriver } from '@duoduo/ai/testing';

const transport = createFixtureTransportDriver();
const ai = createAi({
  transport,
  networkPolicy: createAllowlistNetworkPolicy({
    origins: ['https://api.openai.com'],
  }),
  credentialOverridePolicy: { allow: () => true },
});
const provider = createOpenAiProvider();
ai.providers.register(provider);
const context: AiContext = { messages: [] };
const credentialOverride: RequestCredentialOverride = {
  type: 'api_key',
  secret: secret('fixture-only'),
};

export async function compileOpenAiConsumer(): Promise<void> {
  const model = await ai.models.require(
    {
      providerInstanceId: provider.id,
      modelId: 'gpt-4.1-mini',
      protocol: 'openai-responses',
    },
    {},
    { credentialOverride },
  );
  ai.stream(model, context, { credentialOverride });
}
