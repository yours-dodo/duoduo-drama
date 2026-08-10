import type { StoryArtifactSnapshot } from '../../../domain/story/story-artifact.js';
import type { StoryArtifactVersionSnapshot } from '../../../domain/story/story-artifact-version.js';
import {
  StoryArtifactVersionNotFoundError,
  StoryArtifactVersionConflictError,
} from './story-errors.js';

export function requireArtifactVersion(
  artifact: StoryArtifactSnapshot,
  version: StoryArtifactVersionSnapshot | null,
  input: {
    versionId: string;
    expectedVersionNumber: number;
    requireCurrent: boolean;
  },
): StoryArtifactVersionSnapshot {
  if (
    version === null ||
    version.id !== input.versionId ||
    version.artifactId !== artifact.id
  ) {
    throw new StoryArtifactVersionNotFoundError();
  }
  if (version.versionNumber !== input.expectedVersionNumber) {
    throw new StoryArtifactVersionConflictError();
  }
  if (input.requireCurrent && artifact.currentVersionId !== version.id) {
    throw new StoryArtifactVersionConflictError();
  }
  return version;
}

export function currentVersionNumber(
  artifact: StoryArtifactSnapshot,
  versions: StoryArtifactVersionSnapshot[],
): number | null {
  if (artifact.currentVersionId === null) return null;
  const current = versions.find(
    (version) => version.id === artifact.currentVersionId,
  );
  if (current === undefined || current.artifactId !== artifact.id) {
    throw new StoryArtifactVersionNotFoundError();
  }
  return current.versionNumber;
}
