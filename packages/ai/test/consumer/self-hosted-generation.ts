import { createAi, secret } from '@duoduo/ai';
import { imagePrompt, type ImageGenerationResult } from '@duoduo/ai/images';
import type {
  VideoGenerationResult,
  VideoOperationRef,
} from '@duoduo/ai/videos';
import {
  createDuoduoGenerationAdapter,
  duoduoGenerationContract,
  type DuoduoGenerationGateway,
} from '@duoduo/ai/protocols/duoduo-generation-v1';
import {
  selfHostedGenerationProvider,
  selfHostedImageModelRef,
  selfHostedVideoModelRef,
} from '@duoduo/ai/providers/self-hosted-generation';
import {
  createFakeGenerationGateway,
  type FakeGenerationGateway,
} from '@duoduo/ai/testing';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('consumer-only-example'),
  scheme: 'Bearer',
};

async function exerciseSelfHostedGeneration(): Promise<{
  image: ImageGenerationResult;
  video: VideoGenerationResult;
  operation: VideoOperationRef;
}> {
  const gateway: FakeGenerationGateway = createFakeGenerationGateway({
    adapterId: 'consumer-fixture',
  });
  gateway.publishModel({
    domain: 'images',
    id: 'flux-dev',
    upstreamModelId: 'black-forest-labs/flux-dev',
    name: 'Flux Dev',
  });
  gateway.publishModel({
    domain: 'videos',
    id: 'wan-video',
    upstreamModelId: 'wan/2.1-video',
    name: 'Wan Video',
  });

  const ai = createAi({
    credentialOverridePolicy: { allow: () => true },
  });
  ai.providers.register(await selfHostedGenerationProvider({ gateway }));

  const scope = {};
  const imageModel = await ai.images.models.require(
    selfHostedImageModelRef('flux-dev'),
    scope,
    { credentialOverride },
  );
  const imageStream = ai.images.stream(
    imageModel,
    { content: imagePrompt('A tiny theatre.') },
    { credentialOverride },
  );
  const image = await imageStream.result();

  const videoModel = await ai.videos.models.require(
    selfHostedVideoModelRef('wan-video'),
    scope,
    { credentialOverride },
  );
  const videoStream = ai.videos.stream(
    videoModel,
    {
      operation: 'generate',
      content: [{ type: 'text', text: 'Open the curtains.' }],
    },
    { credentialOverride },
  );
  const iterator = videoStream[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  const operation = await videoStream.detach();
  const resumed = await ai.videos.resume(operation, {
    scope,
    credentialOverride,
    pollIntervalMs: 0,
  });
  const video = await resumed.result();

  return { image, video, operation };
}

const gatewayContract: DuoduoGenerationGateway = createFakeGenerationGateway();
void createDuoduoGenerationAdapter(gatewayContract);
void duoduoGenerationContract;
void exerciseSelfHostedGeneration;
