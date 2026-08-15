import {
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  createAiStoryImageGenerator,
  type StoryImageGeneratorHandle,
} from './ai/story-image-generator.js';
import {
  STORY_IMAGE_CONFIG,
  type StoryImageConfig,
} from './config/story-image-config.js';
import type { LinearScript } from './contracts/story-script.js';
import {
  StoryImagesWorkflow,
  type StorySceneImage,
} from './workflows/story-images/story-images.workflow.js';

export interface GenerateStoryImagesInput {
  script: LinearScript;
  previousImages?: Readonly<Record<string, string>>;
}

export interface GenerateStoryImagesOutput {
  status: 'succeeded';
  images: StorySceneImage[];
}

@Injectable()
export class StoryImagesService implements OnApplicationShutdown {
  private readonly handle: StoryImageGeneratorHandle;
  private readonly workflow: StoryImagesWorkflow;

  constructor(@Inject(STORY_IMAGE_CONFIG) config: StoryImageConfig) {
    this.handle = createAiStoryImageGenerator(config);
    this.workflow = new StoryImagesWorkflow(this.handle.generator);
  }

  async generate(
    input: GenerateStoryImagesInput,
  ): Promise<GenerateStoryImagesOutput> {
    const images = await this.workflow.generate({
      script: input.script,
      previousImages: input.previousImages,
    });
    return { status: 'succeeded', images };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.dispose();
  }
}

