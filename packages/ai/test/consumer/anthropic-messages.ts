import {
  createAi,
  secret,
  type AiContext,
  type RequestCredentialOverride,
} from '@duoduo/ai';
import { createAnthropicProvider } from '@duoduo/ai/providers/anthropic';
import { runAnthropicMessages } from '@duoduo/ai/protocols/anthropic-messages';
import { createAllowlistNetworkPolicy } from '@duoduo/ai/transport';
import { createFixtureTransportDriver } from '@duoduo/ai/testing';

const ai = createAi({
  transport: createFixtureTransportDriver(),
  networkPolicy: createAllowlistNetworkPolicy({
    origins: ['https://api.anthropic.com'],
  }),
  credentialOverridePolicy: { allow: () => true },
});
const provider = createAnthropicProvider({ oauth: false });
ai.providers.register(provider);
const context: AiContext = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
};
const credentialOverride: RequestCredentialOverride = {
  type: 'api_key',
  secret: secret('fixture-only'),
  scheme: '',
};

export async function compileAnthropicMessagesConsumer(): Promise<void> {
  const model = await ai.models.require(
    {
      providerInstanceId: provider.id,
      modelId: 'claude-sonnet-4-5',
      protocol: 'anthropic-messages',
    },
    {},
    { credentialOverride },
  );
  ai.stream(model, context, { credentialOverride });
  void runAnthropicMessages;
}
