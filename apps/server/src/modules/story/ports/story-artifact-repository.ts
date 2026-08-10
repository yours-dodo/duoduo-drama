import type { StoryArtifactSnapshot } from '../../../domain/story/story-artifact.js';

export const STORY_ARTIFACT_REPOSITORY = Symbol('STORY_ARTIFACT_REPOSITORY');

export interface StoryArtifactRepository {
  create(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot>;
  update(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot>;
  findById(request: {
    tenantId: string;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null>;
  listForProject(request: {
    tenantId: string;
    projectId: string;
  }): Promise<StoryArtifactSnapshot[]>;
}
