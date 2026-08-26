import type {
  StoryProjectStatus,
  StoryProjectVisibility,
} from './story-project.js';
import {
  hasProjectPermission,
  type ProjectCollaboratorRole,
  type ProjectPermissionOverride,
} from './project-collaborator.js';

export interface ProjectAccessSubject {
  userId: string;
  role: 'admin' | 'member' | null;
  collaborator: boolean;
  collaboratorRole?: ProjectCollaboratorRole | null;
  permissionOverrides?: readonly ProjectPermissionOverride[];
}

export interface ProjectAccessSnapshot {
  ownerUserId: string;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
  spaceKind?: 'personal' | 'team';
  purgeAt?: Date | null;
  purgeStartedAt?: Date | null;
}

function isPersonalProject(project: ProjectAccessSnapshot): boolean {
  return project.spaceKind === 'personal';
}

function isTeamProject(project: ProjectAccessSnapshot): boolean {
  return (
    project.spaceKind === 'team' ||
    (project.spaceKind === undefined && project.visibility === 'team')
  );
}

export function canViewProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.ownerUserId === subject.userId) {
    return true;
  }
  if (subject.role === 'admin' && !isPersonalProject(project)) return true;
  return isTeamProject(project) && subject.role !== null;
}

export function canEditProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.status !== 'active') return false;
  if (project.ownerUserId === subject.userId) {
    return true;
  }
  if (subject.role === 'admin' && !isPersonalProject(project)) return true;
  return (
    isTeamProject(project) &&
    subject.collaboratorRole !== null &&
    subject.collaboratorRole !== undefined &&
    hasProjectPermission(
      subject.collaboratorRole,
      subject.permissionOverrides ?? [],
      'project.edit',
    )
  );
}

export function canManageProjectCollaborators(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.status !== 'active' || !isTeamProject(project)) {
    return false;
  }
  if (subject.role === 'admin' || project.ownerUserId === subject.userId) {
    return true;
  }
  return (
    subject.collaboratorRole !== null &&
    subject.collaboratorRole !== undefined &&
    hasProjectPermission(
      subject.collaboratorRole,
      subject.permissionOverrides ?? [],
      'project.manage_collaborators',
    )
  );
}

export function canArchiveProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.status !== 'active') return false;
  return canManageProjectArchive(project, subject);
}

export function canRestoreProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
  now = new Date(),
): boolean {
  if (
    project.status !== 'archived' ||
    (project.purgeStartedAt !== null && project.purgeStartedAt !== undefined) ||
    project.purgeAt === null ||
    project.purgeAt === undefined ||
    project.purgeAt.getTime() <= now.getTime()
  ) {
    return false;
  }
  return canManageProjectArchive(project, subject);
}

function canManageProjectArchive(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.ownerUserId === subject.userId) {
    return true;
  }
  if (subject.role === 'admin' && !isPersonalProject(project)) return true;
  return (
    isTeamProject(project) &&
    subject.collaboratorRole !== null &&
    subject.collaboratorRole !== undefined &&
    hasProjectPermission(
      subject.collaboratorRole,
      subject.permissionOverrides ?? [],
      'project.archive',
    )
  );
}
