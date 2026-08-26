import { buildStoryTagMessages } from './story-tags.prompts.js';
import type {
  StoryTextGenerator,
  StoryTextGenerationOptions,
} from '../story-script/story-script.workflow.js';

export type StoryTagEra = '现代' | '古代';

export interface StoryTagsResult {
  era: StoryTagEra;
  tags: string[];
}

export type StoryTagsFailureCode =
  'agent_unavailable' | 'timeout' | 'protocol_error';

export class StoryTagsWorkflowError extends Error {
  constructor(
    readonly failureCode: StoryTagsFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'StoryTagsWorkflowError';
  }
}

export class StoryTagsWorkflow {
  constructor(private readonly generator: StoryTextGenerator) {}

  async summarize(input: {
    title: string;
    description: string;
  }): Promise<StoryTagsResult> {
    const title = input.title.trim();
    const description = input.description.trim();
    if (!title || !description) {
      throw new StoryTagsWorkflowError(
        'protocol_error',
        'title and description are required',
      );
    }

    let raw: string;
    try {
      const options: StoryTextGenerationOptions = {
        temperature: 0.2,
        timeoutMs: 60_000,
      };
      raw = await this.generator.generateText(
        buildStoryTagMessages({ title, description }),
        options,
      );
    } catch (error) {
      if (error instanceof StoryTagsWorkflowError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new StoryTagsWorkflowError(
        'agent_unavailable',
        `story tag generation failed: ${message}`,
      );
    }

    try {
      return parseStoryTags(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StoryTagsWorkflowError(
        'protocol_error',
        `story tag response is invalid: ${message}`,
      );
    }
  }
}

function parseStoryTags(raw: string): StoryTagsResult {
  const normalized = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const parsed = JSON.parse(normalized) as {
    era?: unknown;
    tags?: unknown;
  };
  if (parsed.era !== '现代' && parsed.era !== '古代') {
    throw new Error('era must be 现代 or 古代');
  }
  if (!Array.isArray(parsed.tags) || parsed.tags.length > 16) {
    throw new Error('tags must be an array with at most 16 items');
  }
  const tags: string[] = [];
  for (const item of parsed.tags) {
    if (typeof item !== 'string') throw new Error('tag must be a string');
    const tag = item.trim();
    if (tag.length < 1 || tag.length > 50) {
      throw new Error('tag length must be between 1 and 50');
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { era: parsed.era, tags };
}
