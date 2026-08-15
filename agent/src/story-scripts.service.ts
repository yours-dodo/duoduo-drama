import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';

import {
  createAiStoryTextGenerator,
  type StoryTextGeneratorHandle,
} from './ai/story-text-generator.js';
import {
  STORY_SCRIPT_CONFIG,
  type StoryScriptConfig,
} from './config/story-script-config.js';
import {
  STORY_SPEECH_CONFIG,
  type StorySpeechConfig,
} from './config/story-speech-config.js';
import type { LinearScript } from './contracts/story-script.js';
import {
  StoryScriptWorkflow,
  StoryScriptWorkflowError,
} from './workflows/story-script/story-script.workflow.js';

export interface GenerateStoryScriptInput {
  requestId?: string;
  userPrompt: string;
  previousArtifacts?: string;
  history?: string;
}

export interface GenerateStoryScriptOutput {
  requestId: string;
  status: 'succeeded';
  title: string;
  summary: string;
  markdown: string;
  script: LinearScript;
}

export const STORY_SCRIPT_WORKFLOW = Symbol('STORY_SCRIPT_WORKFLOW');

@Injectable()
export class StoryScriptsService implements OnApplicationShutdown {
  private readonly handle: StoryTextGeneratorHandle;
  private readonly workflow: StoryScriptWorkflow;

  constructor(
    @Inject(STORY_SCRIPT_CONFIG) config: StoryScriptConfig,
    @Inject(STORY_SPEECH_CONFIG) speechConfig: StorySpeechConfig,
  ) {
    this.handle = createAiStoryTextGenerator(config);
    this.workflow = new StoryScriptWorkflow(this.handle.generator);
    this.voiceCatalog = speechConfig.voiceCatalog;
  }

  private readonly voiceCatalog: string;

  async generate(
    input: GenerateStoryScriptInput,
  ): Promise<GenerateStoryScriptOutput> {
    const userPrompt = input.userPrompt.trim();
    if (userPrompt.length < 2 || userPrompt.length > 5000) {
      throw new StoryScriptWorkflowError(
        'protocol_error',
        'userPrompt must contain 2-5000 characters',
      );
    }
    const result = await this.workflow.generate({
      userPrompt,
      context: {
        previousArtifacts: input.previousArtifacts,
        history: input.history,
        voiceCatalog: this.voiceCatalog,
      },
    });
    return {
      requestId: input.requestId?.trim() || randomUUID(),
      status: 'succeeded',
      title: result.script.title,
      summary: result.summary,
      markdown: result.markdown,
      script: result.script,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.dispose();
  }
}
