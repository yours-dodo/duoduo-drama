import { Inject, Injectable } from '@nestjs/common';

import { STORY_VIDEO_CONFIG, type StoryVideoConfig } from './config/story-video-config.js';
import type { LinearScript } from './contracts/story-script.js';
import {
  StoryVideoWorkflow,
  type StoryVideoResult,
} from './workflows/story-video/story-video.workflow.js';
import type { SceneImage, ShotAudio } from './workflows/story-video/render-list.js';

export interface RenderStoryVideoInput {
  script: LinearScript;
  images: SceneImage[];
  audio: ShotAudio[];
}

export interface RenderStoryVideoOutput extends StoryVideoResult {
  status: 'succeeded';
}

@Injectable()
export class StoryVideoService {
  private readonly workflow: StoryVideoWorkflow;

  constructor(@Inject(STORY_VIDEO_CONFIG) config: StoryVideoConfig) {
    this.workflow = new StoryVideoWorkflow(config);
  }

  async render(input: RenderStoryVideoInput): Promise<RenderStoryVideoOutput> {
    const result = await this.workflow.render(input);
    return { status: 'succeeded', ...result };
  }
}

