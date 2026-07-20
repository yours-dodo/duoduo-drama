import { createAi, secret } from '@duoduo/ai';
import {
  imagePrompt,
  type ImageGenerationResult,
  type ImageModelHandle,
  type ImageOperationRef,
} from '@duoduo/ai/images';
import { type GenerationOperationCodec } from '@duoduo/ai/generation';
import { createDashScopeImagesAdapter } from '@duoduo/ai/protocols/dashscope-images';
import { createDashScopeImageTasksAdapter } from '@duoduo/ai/protocols/dashscope-image-tasks';
import {
  openRouterImageModelRef,
  openRouterProvider,
  type OpenRouterImageModelInput,
} from '@duoduo/ai/providers/openrouter';

const modelInput: OpenRouterImageModelInput = {
  id: 'example/image-model',
  output: ['text', 'image'],
};
const ai = createAi({
  credentialOverridePolicy: { allow: () => true },
});
ai.providers.register(openRouterProvider({ imageModels: [modelInput] }));

const input = { content: imagePrompt('Draw a production-ready icon.') };
const ref = openRouterImageModelRef();
const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('consumer-only-example'),
  scheme: 'Bearer',
};

async function generateImage(): Promise<ImageGenerationResult> {
  const model: ImageModelHandle<'openrouter-images'> =
    await ai.images.models.require(ref, {}, { credentialOverride });
  return ai.images.generate(model, input, { credentialOverride });
}

void generateImage;

void (undefined as unknown as ImageOperationRef);
void (undefined as unknown as GenerationOperationCodec);
void createDashScopeImagesAdapter;
void createDashScopeImageTasksAdapter;
