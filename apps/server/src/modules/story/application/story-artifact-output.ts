import type { StoryArtifactSnapshot } from '../../../domain/story/story-artifact.js';
import type { StoryArtifactVersionSnapshot } from '../../../domain/story/story-artifact-version.js';

export function artifactOutput(artifact: StoryArtifactSnapshot) {
  return {
    id: artifact.id,
    tenantId: artifact.tenantId,
    projectId: artifact.projectId,
    type: artifact.type,
    title: artifact.title,
    status: artifact.status,
    currentVersionId: artifact.currentVersionId,
    createdAt: new Date(artifact.createdAt),
    updatedAt: new Date(artifact.updatedAt),
  };
}

export function artifactVersionOutput(version: StoryArtifactVersionSnapshot) {
  return {
    id: version.id,
    tenantId: version.tenantId,
    artifactId: version.artifactId,
    versionNumber: version.versionNumber,
    content: version.content,
    contentFormat: version.contentFormat,
    status: version.status,
    sourceType: version.sourceType,
    sourceMessageId: version.sourceMessageId,
    generationRequestId: version.generationRequestId,
    createdByUserId: version.createdByUserId,
    createdAt: new Date(version.createdAt),
  };
}
