import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';

export const PROJECT_COLLABORATOR_REPOSITORY = Symbol(
  'PROJECT_COLLABORATOR_REPOSITORY',
);

export interface ProjectCollaboratorSnapshot {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  createdAt: Date;
}

export interface ProjectCollaboratorListItem extends ProjectCollaboratorSnapshot {
  email: string;
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
  }): Promise<void>;
  removeAll(request: { tenantId: string; projectId: string }): Promise<number>;
}
