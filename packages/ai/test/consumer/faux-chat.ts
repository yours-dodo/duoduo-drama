import { createAi, type AiContext } from '@duoduo/ai';
import { createFauxProvider } from '@duoduo/ai/testing';

const ai = createAi();
const fixture = createFauxProvider();
ai.providers.register(fixture.provider);
const context: AiContext = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
};

export async function runConsumerFixture(): Promise<string> {
  const model = await ai.models.require(fixture.modelRef, {});
  const response = await ai.complete(model, context);
  return response.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}
