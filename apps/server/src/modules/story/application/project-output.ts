import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';

export function projectOutput(
  project: StoryProjectSnapshot,
  access: {
    collaborator: boolean;
    collaboratorRole?: string | null;
    canEdit: boolean;
    canManageCollaborators: boolean;
  } = {
    collaborator: false,
    collaboratorRole: null,
    canEdit: false,
    canManageCollaborators: false,
  },
) {
  return {
    id: project.id,
    tenantId: project.tenantId,
    spaceId: project.spaceId,
    spaceKind: project.spaceKind ?? null,
    createdByUserId: project.createdByUserId,
    ownerUserId: project.ownerUserId,
    title: project.title,
    visibility: project.visibility,
    status: project.status,
    revision: project.revision,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    ...access,
  };
}
