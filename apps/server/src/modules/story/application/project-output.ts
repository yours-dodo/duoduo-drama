import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';

export function projectOutput(
  project: StoryProjectSnapshot,
  access: {
    collaborator: boolean;
    canEdit: boolean;
    canManageCollaborators: boolean;
  } = {
    collaborator: false,
    canEdit: false,
    canManageCollaborators: false,
  },
) {
  return {
    id: project.id,
    tenantId: project.tenantId,
    createdByUserId: project.createdByUserId,
    title: project.title,
    visibility: project.visibility,
    status: project.status,
    revision: project.revision,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    ...access,
  };
}
