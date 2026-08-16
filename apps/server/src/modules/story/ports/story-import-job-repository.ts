import type { StoryImportJobSnapshot } from '../../../domain/story/story-import-job.js';

export const STORY_IMPORT_JOB_REPOSITORY = Symbol(
  'STORY_IMPORT_JOB_REPOSITORY',
);

export interface StoryImportJobRepository {
  create(job: StoryImportJobSnapshot): Promise<StoryImportJobSnapshot>;
  findById(request: {
    tenantId: string | null;
    jobId: string;
  }): Promise<StoryImportJobSnapshot | null>;
}
