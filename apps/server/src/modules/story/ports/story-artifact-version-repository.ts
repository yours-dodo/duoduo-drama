import type { StoryArtifactVersionSnapshot } from '../../../domain/story/story-artifact-version.js';

export const STORY_ARTIFACT_VERSION_REPOSITORY = Symbol(
  'STORY_ARTIFACT_VERSION_REPOSITORY',
);

export interface StoryArtifactVersionRepository {
  create(
    version: StoryArtifactVersionSnapshot,
  ): Promise<StoryArtifactVersionSnapshot>;
  update(
    version: StoryArtifactVersionSnapshot,
  ): Promise<StoryArtifactVersionSnapshot>;
  findById(request: {
    tenantId: string | null;
    versionId: string;
  }): Promise<StoryArtifactVersionSnapshot | null>;
  listForArtifact(request: {
    tenantId: string | null;
    artifactId: string;
  }): Promise<StoryArtifactVersionSnapshot[]>;
}
