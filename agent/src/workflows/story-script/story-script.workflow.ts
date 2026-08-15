import {
  parseLinearScript,
  toLinearScriptMarkdown,
  type LinearScript,
} from '../../contracts/story-script.js';
import {
  buildStoryScriptMessages,
  type StoryScriptGenerationContext,
} from './story-script.prompts.js';

export interface StoryTextMessage {
  role: 'system' | 'user';
  content: string;
}

export interface StoryTextGenerationOptions {
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Port owned by the workflow. The concrete adapter composes `@duoduo/ai` at
 * the application boundary; the workflow itself stays provider-neutral.
 */
export interface StoryTextGenerator {
  generateText(
    messages: StoryTextMessage[],
    options?: StoryTextGenerationOptions,
  ): Promise<string>;
}

export type StoryScriptFailureCode =
  | 'agent_unavailable'
  | 'timeout'
  | 'protocol_error';

export class StoryScriptWorkflowError extends Error {
  constructor(
    readonly failureCode: StoryScriptFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoryScriptWorkflowError';
  }
}

export interface StoryScriptWorkflowResult {
  script: LinearScript;
  summary: string;
  markdown: string;
}

export class StoryScriptWorkflow {
  constructor(private readonly generator: StoryTextGenerator) {}

  async generate(input: {
    userPrompt: string;
    context?: StoryScriptGenerationContext;
  }): Promise<StoryScriptWorkflowResult> {
    if (!input.userPrompt.trim()) {
      throw new StoryScriptWorkflowError(
        'protocol_error',
        'userPrompt is required',
      );
    }

    let raw: string;
    try {
      raw = await this.generator.generateText(
        buildStoryScriptMessages(input.userPrompt, input.context),
        { temperature: 0.7, timeoutMs: 120_000 },
      );
    } catch (error) {
      if (error instanceof StoryScriptWorkflowError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoryScriptWorkflowError(
        'agent_unavailable',
        `story text generation failed: ${message}`,
      );
    }

    let script: LinearScript;
    try {
      script = parseLinearScript(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StoryScriptWorkflowError(
        'protocol_error',
        `story script response is invalid: ${message}`,
      );
    }

    return {
      script,
      summary: `已根据你的描述生成完整短剧《${script.title}》：${script.episodes.length} 集，共 ${countShots(script)} 个镜头。`,
      markdown: toLinearScriptMarkdown(script),
    };
  }
}

export function countShots(script: LinearScript): number {
  return script.episodes.reduce(
    (episodeTotal, episode) =>
      episodeTotal +
      episode.scenes.reduce(
        (sceneTotal, scene) => sceneTotal + scene.shots.length,
        0,
      ),
    0,
  );
}

