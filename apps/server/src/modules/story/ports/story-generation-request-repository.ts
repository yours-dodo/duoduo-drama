import type { StoryGenerationRequestSnapshot } from '../../../domain/story/story-generation-request.js';

export const STORY_GENERATION_REQUEST_REPOSITORY = Symbol(
  'STORY_GENERATION_REQUEST_REPOSITORY',
);

export interface StoryGenerationRequestRepository {
  create(
    request: StoryGenerationRequestSnapshot,
  ): Promise<StoryGenerationRequestSnapshot>;
  findByTriggerMessageId(request: {
    tenantId: string;
    triggerMessageId: string;
  }): Promise<StoryGenerationRequestSnapshot | null>;
}
