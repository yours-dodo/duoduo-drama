import { randomUUID } from 'node:crypto';

import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import { StoryImagesService } from './story-images.service.js';
import { StoryScriptsService } from './story-scripts.service.js';
import { StorySpeechService } from './story-speech.service.js';
import { StoryVideoService } from './story-video.service.js';

export type StoryTaskStage =
  'queued' | 'script' | 'images' | 'speech' | 'video';

export type StoryTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface StoryTaskInput {
  requestId?: string;
  userPrompt: string;
  previousArtifacts?: string;
  history?: string;
}

export interface StoryTaskSnapshot {
  taskId: string;
  status: StoryTaskStatus;
  stage: StoryTaskStage;
  error?: string;
  result?: {
    script: unknown;
    images: unknown[];
    audio: unknown[];
    video?: unknown;
  };
  createdAt: number;
  updatedAt: number;
}

type StoryTask = StoryTaskSnapshot;

@Injectable()
export class StoryTaskService implements OnModuleDestroy {
  private readonly tasks = new Map<string, StoryTask>();
  private disposed = false;

  constructor(
    @Inject(StoryScriptsService) private readonly scripts: StoryScriptsService,
    @Inject(StoryImagesService) private readonly images: StoryImagesService,
    @Inject(StorySpeechService) private readonly speech: StorySpeechService,
    @Inject(StoryVideoService) private readonly video: StoryVideoService,
  ) {}

  create(input: StoryTaskInput): StoryTaskSnapshot {
    const taskId = `story_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = Date.now();
    const task: StoryTask = {
      taskId,
      status: 'queued',
      stage: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    void this.run(taskId, input);
    return this.snapshot(taskId)!;
  }

  get(taskId: string): StoryTaskSnapshot | undefined {
    return this.snapshot(taskId);
  }

  private snapshot(taskId: string): StoryTaskSnapshot | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;
    return {
      taskId: task.taskId,
      status: task.status,
      stage: task.stage,
      ...(task.error !== undefined ? { error: task.error } : {}),
      ...(task.result !== undefined ? { result: task.result } : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private async run(taskId: string, input: StoryTaskInput): Promise<void> {
    const patch = (update: Partial<StoryTask>) => {
      const task = this.tasks.get(taskId);
      if (!task || this.disposed) return;
      Object.assign(task, update, { updatedAt: Date.now() });
    };
    try {
      patch({ status: 'running', stage: 'script' });
      const scriptResult = await this.scripts.generate({
        requestId: input.requestId,
        userPrompt: input.userPrompt,
        previousArtifacts: input.previousArtifacts,
        history: input.history,
      });

      patch({ stage: 'images' });
      const imagesResult = await this.images.generate({
        script: scriptResult.script,
      });

      patch({ stage: 'speech' });
      let speechResult;
      try {
        speechResult = await this.speech.generate({
          script: scriptResult.script,
        });
      } catch (error) {
        // TTS is best-effort: a provider outage degrades to silent dialogue
        // (subtitles remain) instead of failing the whole generation.
        console.warn(
          `[story-task] speech degraded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        speechResult = { status: 'succeeded', audio: [] };
      }

      patch({ stage: 'video' });
      let videoResult;
      try {
        videoResult = await this.video.render({
          script: scriptResult.script,
          images: imagesResult.images,
          audio: speechResult.audio,
        });
      } catch (error) {
        // Video rendering is best-effort: a renderer outage keeps the script,
        // images and audio as the deliverable.
        console.warn(
          `[story-task] video degraded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        videoResult = undefined;
      }

      patch({
        status: 'succeeded',
        stage: 'video',
        result: {
          script: scriptResult.script,
          images: imagesResult.images,
          audio: speechResult.audio,
          ...(videoResult ? { video: videoResult } : {}),
        },
      });
    } catch (error) {
      patch({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.disposed = true;
  }
}
