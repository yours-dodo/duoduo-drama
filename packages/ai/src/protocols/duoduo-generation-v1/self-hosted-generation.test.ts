import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { createAi } from '../../index.js';
import { secret } from '../../auth/secret-value.js';
import { createFixtureTransportDriver } from '../../testing.js';
import { createAllowlistNetworkPolicy } from '../../transport/index.js';
import { createOperationCredentialVerifier } from '../../generation/index.js';
import {
  selfHostedGenerationProvider,
  selfHostedImageModelRef,
  selfHostedVideoModelRef,
} from '../../providers/self-hosted-generation/index.js';
import {
  type DuoduoGenerationGateway,
  type DuoduoGenerationGatewayCatalog,
  type DuoduoGenerationGatewayTask,
} from './index.js';
import {
  createFakeGenerationGateway,
  type FakeGenerationGateway,
} from '../../testing/fake-generation-gateway.js';

const credentialOverride = {
  type: 'api_key' as const,
  secret: secret('owned-gateway-key'),
  scheme: 'Bearer',
};

const imageModel = {
  domain: 'images' as const,
  id: 'flux-dev',
  upstreamModelId: 'black-forest-labs/flux-dev',
  name: 'Flux Dev',
};
const videoModel = {
  domain: 'videos' as const,
  id: 'wan-video',
  upstreamModelId: 'wan/2.1-video',
  name: 'Wan Video',
};

async function createRuntime(gateway: DuoduoGenerationGateway) {
  const ai = createAi({
    transport: createFixtureTransportDriver(),
    networkPolicy: createAllowlistNetworkPolicy({
      origins: ['https://self-hosted-generation.invalid'],
    }),
    credentialOverridePolicy: { allow: () => true },
    operationCredentialVerifier: createOperationCredentialVerifier({
      identityLifetime: 'process-local',
      create: async () => ({
        status: 'created',
        proof: { keyId: 'fake', digest: 'abcdefghijklmnopqrstuvwx' },
      }),
      verify: async () => ({ status: 'match' }),
    }),
  });
  ai.providers.register(await selfHostedGenerationProvider({ gateway }));
  return ai;
}

async function runtime(gateway: FakeGenerationGateway) {
  gateway.publishModel(imageModel);
  gateway.publishModel(videoModel);
  return createRuntime(gateway);
}

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(
      new URL(
        `../../../test/fixtures/self-hosted-generation/${name}`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as T;
}

async function assertPublicConsumerContract(gateway: FakeGenerationGateway) {
  const ai = await runtime(gateway);
  const scope = {};
  const image = await ai.images.models.require(
    selfHostedImageModelRef('flux-dev'),
    scope,
    { credentialOverride },
  );
  const imageStream = ai.images.stream(
    image,
    { content: [{ type: 'text', text: 'a tiny theatre' }] },
    { credentialOverride },
  );
  const imageEvents = [];
  for await (const event of imageStream) imageEvents.push(event);
  const imageResult = await imageStream.result();
  expect(
    imageEvents.filter(({ type }) => type === 'generation_progress'),
  ).toMatchObject([
    { phase: 'queued' },
    { phase: 'preparing' },
    { phase: 'running' },
    { phase: 'finalizing' },
  ]);
  expect(imageResult).toMatchObject({
    status: 'completed',
    outputs: [{ type: 'image', image: { source: { type: 'url' } } }],
    usage: {
      generatedImages: 1,
      compute: { acceleratorType: 'L40S', activeMilliseconds: 900 },
    },
    diagnostics: [{ code: 'GENERATION_GATEWAY_INFRASTRUCTURE_FIELDS_DROPPED' }],
  });
  expect(JSON.stringify(imageEvents)).not.toMatch(
    /gpu-instance-secret|container-secret|10\.0\.0\.8/iu,
  );

  const video = await ai.videos.models.require(
    selfHostedVideoModelRef('wan-video'),
    scope,
    { credentialOverride },
  );
  const detached = ai.videos.stream(
    video,
    {
      operation: 'generate',
      content: [{ type: 'text', text: 'curtains opening' }],
    },
    { credentialOverride },
  );
  const iterator = detached[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  const operation = await detached.detach();
  expect(JSON.stringify(operation)).not.toMatch(
    /gpu-instance-secret|container-secret|10\.0\.0\.8/iu,
  );
  const resumed = await ai.videos.resume(operation, {
    scope,
    pollIntervalMs: 0,
    credentialOverride,
  });
  expect(await resumed.result()).toMatchObject({
    status: 'completed',
    outputs: [
      { type: 'video', video: { artifact: { source: { type: 'url' } } } },
    ],
    usage: { generatedVideos: 1, compute: { acceleratorType: 'L40S' } },
  });
}

describe('self-hosted generation gateway', () => {
  it('runs the same image/video consumer contract through replaceable gateway adapters', async () => {
    await assertPublicConsumerContract(
      createFakeGenerationGateway({ adapterId: 'memory-a' }),
    );
    await assertPublicConsumerContract(
      createFakeGenerationGateway({ adapterId: 'memory-b' }),
    );
  });

  it('publishes immutable dynamic catalog snapshots and removes offline models on refresh', async () => {
    const gateway = createFakeGenerationGateway();
    gateway.publishModel(imageModel);
    gateway.publishModel(videoModel);
    const first = await selfHostedGenerationProvider({ gateway });
    expect(first.images?.models.map(({ id }) => id)).toEqual(['flux-dev']);
    expect(first.videos?.models.map(({ id }) => id)).toEqual(['wan-video']);

    gateway.setModelOnline('images', 'flux-dev', false);
    const refreshed = await selfHostedGenerationProvider({ gateway });
    expect(refreshed.images?.models).toEqual([]);
    expect(refreshed.videos?.models.map(({ id }) => id)).toEqual(['wan-video']);
  });

  it('rejects malformed dynamic catalog model identities', async () => {
    const gateway: DuoduoGenerationGateway = Object.freeze({
      adapterId: 'malformed-catalog',
      async listModels() {
        return {
          revision: 'revision-1',
          models: [
            {
              domain: 'images',
              id: '../flux-dev',
              upstreamModelId: 'black-forest-labs/flux-dev',
              name: 'Flux Dev',
            },
          ],
        };
      },
      async createTask() {
        throw new Error('not used');
      },
      async getTask() {
        throw new Error('not used');
      },
      async cancelTask() {},
    });

    await expect(
      selfHostedGenerationProvider({ gateway }),
    ).rejects.toMatchObject({
      code: 'DUODUO_GENERATION_CATALOG_INVALID',
    });
  });

  it('fails a task when a previously published model goes offline', async () => {
    const gateway = createFakeGenerationGateway();
    const ai = await runtime(gateway);
    const model = await ai.images.models.require(
      selfHostedImageModelRef('flux-dev'),
      {},
      { credentialOverride },
    );

    gateway.setModelOnline('images', 'flux-dev', false);

    expect(
      await ai.images.generate(
        model,
        { content: [{ type: 'text', text: 'an empty stage' }] },
        { credentialOverride },
      ),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'GENERATION_MODEL_OFFLINE' },
    });
  });

  it('cancels the owned gateway task when an active stream is aborted', async () => {
    const gateway = createFakeGenerationGateway({ pollDelayMs: 20 });
    const ai = await runtime(gateway);
    const model = await ai.images.models.require(
      selfHostedImageModelRef('flux-dev'),
      {},
      { credentialOverride },
    );
    const stream = ai.images.stream(
      model,
      { content: [{ type: 'text', text: 'close the curtains' }] },
      { credentialOverride },
    );
    const iterator = stream[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.type).toBe('generation_start');
    const queued = (await iterator.next()).value;
    expect(queued).toMatchObject({
      type: 'generation_progress',
      phase: 'queued',
    });
    expect(
      queued && 'operation' in queued ? queued.operation : undefined,
    ).toBeDefined();

    stream.abort('consumer cancelled');

    expect(await stream.result()).toMatchObject({
      status: 'cancelled',
      error: { category: 'cancelled' },
    });
    expect(gateway.taskState('task-1')).toMatchObject({ status: 'cancelled' });
  });

  it('projects gateway fixtures without accepting remote binding controls or infrastructure fields', async () => {
    const catalog =
      await fixture<DuoduoGenerationGatewayCatalog>('catalog.json');
    const snapshots = await Promise.all(
      [
        'queued.json',
        'preparing.json',
        'running.json',
        'finalizing.json',
        'succeeded-image.json',
      ].map((name) => fixture<DuoduoGenerationGatewayTask>(name)),
    );
    expect(
      (await fixture<DuoduoGenerationGatewayTask>('succeeded-video.json'))
        .status,
    ).toBe('succeeded');
    expect(
      (await fixture<DuoduoGenerationGatewayTask>('cancelled.json')).status,
    ).toBe('cancelled');
    let pollIndex = 1;
    const gateway: DuoduoGenerationGateway = Object.freeze({
      adapterId: 'fixture-gateway',
      async listModels() {
        return catalog;
      },
      async createTask() {
        return snapshots[0]!;
      },
      async getTask() {
        return snapshots[Math.min(pollIndex++, snapshots.length - 1)]!;
      },
      async cancelTask() {},
    });
    const provider = await selfHostedGenerationProvider({ gateway });
    expect(provider.images?.protocols[0]).toMatchObject({
      protocol: 'duoduo-generation-v1',
      operationMode: 'resumable',
      endpoint: 'https://self-hosted-generation.invalid/v1/tasks',
      credential: {
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      },
      defaultProfile: { id: 'duoduo-generation-v1' },
    });
    expect(JSON.stringify(provider)).not.toMatch(
      /attacker\.invalid|x-attacker-key|attacker-protocol|attacker-profile/iu,
    );

    const ai = await createRuntime(gateway);
    const model = await ai.images.models.require(
      selfHostedImageModelRef('flux-dev'),
      {},
      { credentialOverride },
    );
    const stream = ai.images.stream(
      model,
      { content: [{ type: 'text', text: 'fixture theatre' }] },
      { credentialOverride },
    );
    const events = [];
    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(
      events.filter(({ type }) => type === 'generation_progress'),
    ).toMatchObject([
      { phase: 'queued' },
      { phase: 'preparing' },
      { phase: 'running' },
      { phase: 'finalizing' },
    ]);
    expect(result).toMatchObject({
      status: 'completed',
      diagnostics: [
        { code: 'GENERATION_GATEWAY_INFRASTRUCTURE_FIELDS_DROPPED' },
      ],
    });
    expect(JSON.stringify({ events, result })).not.toMatch(
      /gpu-instance-secret|container-secret|gpu-node-secret|10\.0\.0\.8/iu,
    );
  });
});
