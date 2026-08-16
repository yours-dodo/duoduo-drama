import type {
  StoryArtifactSnapshot,
  StoryArtifactType,
} from '../../../domain/story/story-artifact.js';

export const STORY_ARTIFACT_REPOSITORY = Symbol('STORY_ARTIFACT_REPOSITORY');

export interface StoryArtifactRepository {
  create(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot>;
  update(artifact: StoryArtifactSnapshot): Promise<StoryArtifactSnapshot>;
  findById(request: {
    tenantId: string | null;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null>;
  findByIdLocked(request: {
    tenantId: string | null;
    artifactId: string;
  }): Promise<StoryArtifactSnapshot | null>;
  findActiveForProjectAndTypeLocked(request: {
    tenantId: string | null;
    projectId: string;
    type: StoryArtifactType;
  }): Promise<StoryArtifactSnapshot | null>;
  listForProject(request: {
    tenantId: string | null;
    projectId: string;
  }): Promise<StoryArtifactSnapshot[]>;
}
