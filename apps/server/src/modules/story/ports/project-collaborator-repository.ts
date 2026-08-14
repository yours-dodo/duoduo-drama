import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import type {
  ProjectCollaboratorRole,
  ProjectPermissionEffect,
  ProjectPermissionKey,
} from '../../../domain/story/project-collaborator.js';

export const PROJECT_COLLABORATOR_REPOSITORY = Symbol(
  'PROJECT_COLLABORATOR_REPOSITORY',
);

export interface ProjectCollaboratorSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  role: ProjectCollaboratorRole;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
}

export interface ProjectCollaboratorListItem extends ProjectCollaboratorSnapshot {
  email: string;
}

export interface ProjectCollaboratorPermissionOverrideSnapshot {
  id: string;
  collaboratorId: string;
  permissionKey: ProjectPermissionKey;
  effect: ProjectPermissionEffect;
  grantedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCollaboratorRepository {
  create(
    collaborator: ProjectCollaboratorSnapshot,
  ): Promise<ProjectCollaboratorSnapshot>;
  findByProjectAndUserLocked(request: {
    tenantId: string;
    projectId: string;
    userId: string;
  }): Promise<ProjectCollaboratorSnapshot | null>;
  listPermissionOverrides?(request: {
    collaboratorId: string;
  }): Promise<ProjectCollaboratorPermissionOverrideSnapshot[]>;
  updateRole?(request: {
    tenantId: string;
    projectId: string;
    userId: string;
    role: ProjectCollaboratorRole;
    updatedAt: Date;
  }): Promise<ProjectCollaboratorSnapshot>;
  upsertPermissionOverride?(override: {
    id: string;
    collaboratorId: string;
    permissionKey: ProjectPermissionKey;
    effect: ProjectPermissionEffect;
    grantedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<ProjectCollaboratorPermissionOverrideSnapshot>;
  removePermissionOverride?(request: {
    collaboratorId: string;
    permissionKey: ProjectPermissionKey;
  }): Promise<void>;
  listForProject(request: {
    tenantId: string;
    projectId: string;
    page: KeysetPageRequest;
  }): Promise<{
    items: ProjectCollaboratorListItem[];
    next: { at: Date; id: string } | null;
  }>;
  remove(request: {
    tenantId: string;
    projectId: string;
    userId: string;
    revokedAt: Date;
  }): Promise<void>;
  removeAll(request: {
    tenantId: string;
    projectId: string;
    revokedAt: Date;
  }): Promise<number>;
}
