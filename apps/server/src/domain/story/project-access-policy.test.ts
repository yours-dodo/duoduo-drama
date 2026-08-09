import { describe, expect, it } from 'vitest';

import {
  canEditProject,
  canManageProjectCollaborators,
  canViewProject,
  type ProjectAccessSubject,
} from './project-access-policy.js';

const project = {
  createdByUserId: 'creator-id',
  visibility: 'team' as const,
  status: 'active' as const,
};

describe('story project access policy', () => {
  it.each([
    [
      'administrator',
      { userId: 'admin-id', role: 'admin', collaborator: false },
    ],
    ['creator', { userId: 'creator-id', role: 'member', collaborator: false }],
    [
      'collaborator',
      { userId: 'writer-id', role: 'member', collaborator: true },
    ],
  ] satisfies Array<[string, ProjectAccessSubject]>)(
    '%s can edit a team project',
    (_label, subject) => {
      expect(canEditProject(project, subject)).toBe(true);
    },
  );

  it('allows ordinary members to view a team project but not edit it', () => {
    const subject: ProjectAccessSubject = {
      userId: 'reader-id',
      role: 'member',
      collaborator: false,
    };

    expect(canViewProject(project, subject)).toBe(true);
    expect(canEditProject(project, subject)).toBe(false);
    expect(canManageProjectCollaborators(project, subject)).toBe(false);
  });

  it('hides private projects from ordinary members and collaborators', () => {
    const privateProject = { ...project, visibility: 'private' as const };

    expect(
      canViewProject(privateProject, {
        userId: 'reader-id',
        role: 'member',
        collaborator: true,
      }),
    ).toBe(false);
    expect(
      canViewProject(privateProject, {
        userId: 'creator-id',
        role: 'member',
        collaborator: false,
      }),
    ).toBe(true);
    expect(
      canViewProject(privateProject, {
        userId: 'admin-id',
        role: 'admin',
        collaborator: false,
      }),
    ).toBe(true);
  });

  it('only an administrator or creator manages collaborators', () => {
    expect(
      canManageProjectCollaborators(project, {
        userId: 'admin-id',
        role: 'admin',
        collaborator: false,
      }),
    ).toBe(true);
    expect(
      canManageProjectCollaborators(project, {
        userId: 'creator-id',
        role: 'member',
        collaborator: false,
      }),
    ).toBe(true);
    expect(
      canManageProjectCollaborators(project, {
        userId: 'writer-id',
        role: 'member',
        collaborator: true,
      }),
    ).toBe(false);
  });
});
