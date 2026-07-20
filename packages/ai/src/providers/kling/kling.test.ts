import { describe, expect, it } from 'vitest';

import {
  klingProvider,
  klingVideoModelRef,
  resolveKlingEndpoints,
} from './index.js';

describe('Kling provider', () => {
  it('pins the Singapore API key endpoint and Omni task routes', () => {
    const endpoints = resolveKlingEndpoints();
    expect(endpoints).toMatchObject({
      origin: 'https://api-singapore.klingai.com',
      baseUrl: 'https://api-singapore.klingai.com',
      omniVideoCreateUrl:
        'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
    });
    expect(endpoints.taskQueryUrl('task id')).toBe(
      'https://api-singapore.klingai.com/tasks?task_ids=task+id',
    );
    const provider = klingProvider();
    expect(provider.videos?.models[0]).toMatchObject({
      id: 'kling-video-3-0-omni',
      upstreamModelId: 'kling-3.0-omni',
      protocol: 'kling-video-tasks',
      protocolProfileId: 'kling-video-3-0-omni-v2',
      capabilities: {
        operations: ['generate'],
        inputModalities: ['text', 'image'],
        imageRoles: ['reference', 'first_frame', 'last_frame'],
      },
    });
    expect(provider.videos?.protocols[0]).toMatchObject({
      endpoint: 'https://api-singapore.klingai.com/omni-video/kling-3.0-omni',
      operationActions: ['poll'],
      credential: {
        headerName: 'authorization',
        defaultScheme: 'Bearer',
      },
    });
  });

  it('uses only explicit options and rejects unsafe base URLs or profiles', () => {
    const before = { ...process.env };
    const provider = klingProvider({
      id: 'kling-private',
      baseUrl: 'https://kling.example/api',
      videoModels: [{ id: 'private-omni' }],
    });
    expect(process.env).toEqual(before);
    expect(provider.identity).toMatchObject({
      origin: 'https://kling.example',
      baseUrl: 'https://kling.example/api',
    });
    expect(klingVideoModelRef('private-omni', 'kling-private')).toEqual({
      providerInstanceId: 'kling-private',
      modelId: 'private-omni',
      protocol: 'kling-video-tasks',
    });
    expect(() => klingProvider({ baseUrl: 'http://kling.example' })).toThrow(
      /https/,
    );
    expect(() =>
      klingProvider({
        videoModels: [{ protocolProfileId: 'not-kling' as never }],
      }),
    ).toThrow(/profile/);
  });
});
