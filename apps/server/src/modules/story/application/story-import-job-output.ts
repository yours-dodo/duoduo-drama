import type { StoryImportJobSnapshot } from '../../../domain/story/story-import-job.js';

export function storyImportJobOutput(job: StoryImportJobSnapshot) {
  return {
    ...job,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(job.updatedAt),
    processingStartedAt:
      job.processingStartedAt === null
        ? null
        : new Date(job.processingStartedAt),
    completedAt: job.completedAt === null ? null : new Date(job.completedAt),
  };
}
