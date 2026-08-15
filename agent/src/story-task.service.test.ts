import { describe, expect, it, vi } from 'vitest';

import { StoryImagesService } from './story-images.service.js';
import { StoryScriptsService } from './story-scripts.service.js';
import { StorySpeechService } from './story-speech.service.js';
import { StoryTaskService } from './story-task.service.js';
import { StoryVideoService } from './story-video.service.js';

function fakeServices(overrides: {
  scriptError?: Error;
  images?: unknown[];
  audio?: unknown[];
  video?: unknown;
  speechError?: Error;
  videoError?: Error;
}) {
  return {
    scripts: {
      generate: vi.fn(async () => {
        if (overrides.scriptError) throw overrides.scriptError;
        return { status: 'succeeded', title: '测试', script: { title: '测试' } };
      }),
    },
    images: {
      generate: vi.fn(async () => ({
        status: 'succeeded',
        images: overrides.images ?? [{ sceneId: 's1', imageUrl: 'data:image/png,x' }],
      })),
    },
    speech: {
      generate: vi.fn(async () => {
        if (overrides.speechError) throw overrides.speechError;
        return {
          status: 'succeeded',
          audio: overrides.audio ?? [{ shotId: 'shot-1', audioBase64: 'QUJD', mimeType: 'audio/wav' }],
        };
      }),
    },
    video: {
      render: vi.fn(async () => {
        if (overrides.videoError) throw overrides.videoError;
        return {
          status: 'succeeded',
          outputPath: '/tmp/out.mp4',
          subtitlePath: '/tmp/out.srt',
          durationSeconds: 10,
          sizeBytes: 100,
          segmentCount: 1,
          ...(overrides.video ?? {}),
        };
      }),
    },
  };
}

async function waitForStatus(
  tasks: StoryTaskService,
  taskId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 2000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = tasks.get(taskId);
    if (task && predicate(task.status)) return task;
    if (Date.now() > deadline) throw new Error('task did not reach expected status');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('StoryTaskService', () => {
  it('runs script → images → speech → video and reports success', async () => {
    const fakes = fakeServices({});
    const service = new StoryTaskService(
      fakes.scripts as unknown as StoryScriptsService,
      fakes.images as unknown as StoryImagesService,
      fakes.speech as unknown as StorySpeechService,
      fakes.video as unknown as StoryVideoService,
    );

    const created = service.create({ userPrompt: '写一个故事' });
    expect(['queued', 'running']).toContain(created.status);

    const task = await waitForStatus(service, created.taskId, (s) => s === 'succeeded');
    expect(task.result).toBeDefined();
    expect(task.result!.script).toEqual({ title: '测试' });
    expect(task.result!.images).toHaveLength(1);
    expect(task.result!.audio).toHaveLength(1);
    expect(task.result!.video).toMatchObject({ outputPath: '/tmp/out.mp4' });
    expect(fakes.scripts.generate).toHaveBeenCalledWith(
      expect.objectContaining({ userPrompt: '写一个故事' }),
    );
  });

  it('marks the task failed when script generation throws', async () => {
    const fakes = fakeServices({ scriptError: new Error('provider down') });
    const service = new StoryTaskService(
      fakes.scripts as unknown as StoryScriptsService,
      fakes.images as unknown as StoryImagesService,
      fakes.speech as unknown as StorySpeechService,
      fakes.video as unknown as StoryVideoService,
    );

    const created = service.create({ userPrompt: '写一个故事' });
    const task = await waitForStatus(service, created.taskId, (s) => s === 'failed');
    expect(task.error).toContain('provider down');
  });

  it('returns undefined for unknown task ids', () => {
    const fakes = fakeServices({});
    const service = new StoryTaskService(
      fakes.scripts as unknown as StoryScriptsService,
      fakes.images as unknown as StoryImagesService,
      fakes.speech as unknown as StorySpeechService,
      fakes.video as unknown as StoryVideoService,
    );
    expect(service.get('missing')).toBeUndefined();
  });

  it('degrades speech and video failures instead of failing the task', async () => {
    const fakes = fakeServices({ speechError: new Error('tts down'), videoError: new Error('renderer down') });
    const service = new StoryTaskService(
      fakes.scripts as unknown as StoryScriptsService,
      fakes.images as unknown as StoryImagesService,
      fakes.speech as unknown as StorySpeechService,
      fakes.video as unknown as StoryVideoService,
    );

    const created = service.create({ userPrompt: '写一个故事' });
    const task = await waitForStatus(service, created.taskId, (s) => s === 'succeeded');
    expect(task.result!.audio).toEqual([]);
    expect(task.result!.video).toBeUndefined();
    expect(task.result!.images).toHaveLength(1);
  });
});
