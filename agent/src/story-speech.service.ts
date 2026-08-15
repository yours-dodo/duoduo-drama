import {
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  createStorySpeechGenerator,
  type StorySpeechGeneratorHandle,
} from './ai/story-speech-generator.js';
import {
  STORY_SPEECH_CONFIG,
  type StorySpeechConfig,
} from './config/story-speech-config.js';
import type { LinearScript } from './contracts/story-script.js';
import {
  StorySpeechWorkflow,
  type StoryShotAudio,
} from './workflows/story-speech/story-speech.workflow.js';

export interface GenerateStorySpeechInput {
  script: LinearScript;
}

export interface GenerateStorySpeechOutput {
  status: 'succeeded';
  audio: StoryShotAudio[];
}

@Injectable()
export class StorySpeechService implements OnApplicationShutdown {
  private readonly handle: StorySpeechGeneratorHandle;
  private readonly workflow: StorySpeechWorkflow;

  constructor(@Inject(STORY_SPEECH_CONFIG) config: StorySpeechConfig) {
    this.handle = createStorySpeechGenerator(config);
    this.workflow = new StorySpeechWorkflow(this.handle.generator);
  }

  async generate(
    input: GenerateStorySpeechInput,
  ): Promise<GenerateStorySpeechOutput> {
    const audio = await this.workflow.generate({ script: input.script });
    return { status: 'succeeded', audio };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.dispose();
  }
}

