import { createAi, secret } from '@duoduo/ai';
import type {
  SerializedVideoOperationRef,
  VideoGenerationInput,
  VideoGenerationResult,
  VideoOperationRef,
} from '@duoduo/ai/videos';
import {
  doubaoProvider,
  doubaoVideoModelRef,
  type DoubaoExplicitVideoModelInput,
} from '@duoduo/ai/providers/doubao';
import { klingProvider, klingVideoModelRef } from '@duoduo/ai/providers/kling';
import { xAiProvider, xAiVideoModelRef } from '@duoduo/ai/providers/xai';
import {
  arkVideoTasksContract,
  createArkVideoTasksAdapter,
  type ArkVideoTasksCompatibility,
} from '@duoduo/ai/protocols/ark-video-tasks';
import {
  createKlingVideoTasksAdapter,
  klingVideoTasksContract,
  validateKlingVideoTaskId,
  type KlingVideoTasksCompatibility,
} from '@duoduo/ai/protocols/kling-video-tasks';

const ai = createAi({
  credentialOverridePolicy: { allow: () => true },
});
ai.providers.register(xAiProvider());
ai.providers.register(klingProvider());
const seedanceModel: DoubaoExplicitVideoModelInput = {
  id: 'doubao-seedance-2-0',
  upstreamModelId: 'doubao-seedance-2-0-260128',
  name: 'Doubao Seedance 2.0',
};
ai.providers.register(doubaoProvider({ videoModels: [seedanceModel] }));

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

const arkCompatibility: ArkVideoTasksCompatibility = {
  wireVersion: 1,
  taskApi: 'ark-contents-generations-v3',
  modelFamily: 'seedance-2',
};
void arkCompatibility;
void arkVideoTasksContract;
void createArkVideoTasksAdapter;
void doubaoVideoModelRef();

const klingCompatibility: KlingVideoTasksCompatibility = {
  wireVersion: 2,
  taskApi: 'kling-api-v2',
  modelFamily: 'kling-video-3.0-omni',
};
void klingCompatibility;
void klingVideoTasksContract;
void createKlingVideoTasksAdapter;
void validateKlingVideoTaskId('kling-task-1');
void klingVideoModelRef();
