import type {
  StoryProjectStatus,
  StoryProjectVisibility,
} from './story-project.js';

export interface ProjectAccessSubject {
  userId: string;
  role: 'admin' | 'member';
  collaborator: boolean;
}

export interface ProjectAccessSnapshot {
  createdByUserId: string;
  visibility: StoryProjectVisibility;
  status: StoryProjectStatus;
}

export function canViewProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (subject.role === 'admin' || project.createdByUserId === subject.userId) {
    return true;
  }
  return project.visibility === 'team';
}

export function canEditProject(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.status !== 'active') return false;
  if (subject.role === 'admin' || project.createdByUserId === subject.userId) {
    return true;
  }
  return project.visibility === 'team' && subject.collaborator === true;
}

export function canManageProjectCollaborators(
  project: ProjectAccessSnapshot,
  subject: ProjectAccessSubject,
): boolean {
  if (project.status !== 'active' || project.visibility !== 'team') {
    return false;
  }
  return subject.role === 'admin' || project.createdByUserId === subject.userId;
}
