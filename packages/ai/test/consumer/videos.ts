import { createAi, secret } from '@duoduo/ai';
import type {
  SerializedVideoOperationRef,
  VideoGenerationInput,
  VideoGenerationResult,
  VideoOperationRef,
} from '@duoduo/ai/videos';
import { xAiProvider, xAiVideoModelRef } from '@duoduo/ai/providers/xai';

const ai = createAi({
  credentialOverridePolicy: { allow: () => true },
});
ai.providers.register(xAiProvider());

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('consumer-only-example'),
  scheme: 'Bearer',
};
const input: VideoGenerationInput = {
  operation: 'generate',
  content: [{ type: 'text', text: 'Animate a paper dragon.' }],
};

async function generateVideo(): Promise<VideoGenerationResult> {
  const model = await ai.videos.models.require(
    xAiVideoModelRef(),
    {},
    {
      credentialOverride,
    },
  );
  const stream = ai.videos.stream(model, input, { credentialOverride });
  const operation = await stream.detach();
  const serialized: SerializedVideoOperationRef =
    await ai.videos.serializeOperation(operation);
  const parsed: VideoOperationRef = await ai.videos.parseOperation(serialized);
  const resumed = await ai.videos.resume(parsed, {
    scope: {},
    credentialOverride,
  });
  void resumed;
  return ai.videos.generate(model, input, { credentialOverride });
}

void generateVideo;
