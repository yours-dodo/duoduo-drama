import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';

export function projectOutput(
  project: StoryProjectSnapshot,
  access: {
    collaborator: boolean;
    collaboratorRole?: string | null;
    canEdit: boolean;
    canManageCollaborators: boolean;
    canArchive?: boolean;
    canRestore?: boolean;
  } = {
    collaborator: false,
    collaboratorRole: null,
    canEdit: false,
    canManageCollaborators: false,
    canArchive: false,
    canRestore: false,
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
    description: project.description ?? '',
    era: project.era ?? '现代',
    tags: [...(project.tags ?? [])],
    creationMode: project.creationMode,
    visibility: project.visibility,
    status: project.status,
    archivedAt: project.archivedAt ? new Date(project.archivedAt) : null,
    purgeAt: project.purgeAt ? new Date(project.purgeAt) : null,
    revision: project.revision,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    ...access,
    canArchive: access.canArchive ?? false,
    canRestore: access.canRestore ?? false,
  };
}
