import { createAi, type AiContext, type AssistantResponse } from '@duoduo/ai';
import { createOpenAiProvider } from '@duoduo/ai/providers/openai';
import { createFixtureTransportDriver } from '@duoduo/ai/testing';

const ai = createAi({ transport: createFixtureTransportDriver() });
ai.providers.register(createOpenAiProvider());

const context: AiContext = {
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Write one short line.' }],
    },
  ],
};

export async function compileChatConsumer(): Promise<AssistantResponse> {
  const model = await ai.models.require(
    {
      providerInstanceId: 'openai',
      modelId: 'gpt-4o-mini',
      protocol: 'openai-responses',
    },
    {},
  );
  return ai.complete(model, context);
}
