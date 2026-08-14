import { describe, expect, it } from 'vitest';

import {
  canArchiveProject,
  canEditProject,
  canManageProjectCollaborators,
  canViewProject,
  type ProjectAccessSubject,
} from './project-access-policy.js';

const project = {
  ownerUserId: 'creator-id',
  visibility: 'team' as const,
  status: 'active' as const,
};

const noCollaborator = {
  collaborator: false,
  collaboratorRole: null,
  permissionOverrides: [],
};

describe('story project access policy', () => {
  it.each([
    ['administrator', { userId: 'admin-id', role: 'admin', ...noCollaborator }],
    ['creator', { userId: 'creator-id', role: 'member', ...noCollaborator }],
    [
      'editor collaborator',
      {
        userId: 'writer-id',
        role: 'member',
        collaborator: true,
        collaboratorRole: 'editor' as const,
        permissionOverrides: [],
      },
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
      ...noCollaborator,
    };

    expect(canViewProject(project, subject)).toBe(true);
    expect(canEditProject(project, subject)).toBe(false);
    expect(canManageProjectCollaborators(project, subject)).toBe(false);
  });

  it('gives viewers view-only access and managers collaborator management', () => {
    expect(
      canEditProject(project, {
        userId: 'viewer-id',
        role: 'member',
        collaborator: true,
        collaboratorRole: 'viewer',
        permissionOverrides: [],
      }),
    ).toBe(false);
    expect(
      canManageProjectCollaborators(project, {
        userId: 'manager-id',
        role: 'member',
        collaborator: true,
        collaboratorRole: 'manager',
        permissionOverrides: [],
      }),
    ).toBe(true);
  });

  it('uses deny before allow and permits archive only for an allowed override', () => {
    const editor = {
      userId: 'writer-id',
      role: 'member' as const,
      collaborator: true,
      collaboratorRole: 'editor' as const,
      permissionOverrides: [
        { permissionKey: 'project.archive' as const, effect: 'allow' as const },
      ],
    };
    expect(canArchiveProject(project, editor)).toBe(true);
    expect(
      canArchiveProject(project, {
        ...editor,
        permissionOverrides: [
          {
            permissionKey: 'project.archive' as const,
            effect: 'allow' as const,
          },
          {
            permissionKey: 'project.archive' as const,
            effect: 'deny' as const,
          },
        ],
      }),
    ).toBe(false);
  });

  it('hides private projects from ordinary members and collaborators', () => {
    const privateProject = { ...project, visibility: 'private' as const };

    expect(
      canViewProject(privateProject, {
        userId: 'reader-id',
        role: 'member',
        collaborator: true,
        collaboratorRole: 'editor',
        permissionOverrides: [],
      }),
    ).toBe(false);
    expect(
      canViewProject(privateProject, {
        userId: 'creator-id',
        role: 'member',
        ...noCollaborator,
      }),
    ).toBe(true);
    expect(
      canViewProject(privateProject, {
        userId: 'admin-id',
        role: 'admin',
        ...noCollaborator,
      }),
    ).toBe(true);
  });

  it('does not grant team administrators access to an explicit personal project', () => {
    const personalProject = { ...project, spaceKind: 'personal' as const };

    expect(
      canViewProject(personalProject, {
        userId: 'admin-id',
        role: 'admin',
        ...noCollaborator,
      }),
    ).toBe(false);
    expect(
      canViewProject(personalProject, {
        userId: 'creator-id',
        role: null,
        ...noCollaborator,
      }),
    ).toBe(true);
  });

  it('allows only an administrator, owner, or manager collaborator to manage collaborators', () => {
    expect(
      canManageProjectCollaborators(project, {
        userId: 'admin-id',
        role: 'admin',
        ...noCollaborator,
      }),
    ).toBe(true);
    expect(
      canManageProjectCollaborators(project, {
        userId: 'creator-id',
        role: 'member',
        ...noCollaborator,
      }),
    ).toBe(true);
    expect(
      canManageProjectCollaborators(project, {
        userId: 'writer-id',
        role: 'member',
        collaborator: true,
        collaboratorRole: 'viewer',
        permissionOverrides: [],
      }),
    ).toBe(false);
  });

  it('uses the current owner independently from the creator', () => {
    const transferred = { ...project, ownerUserId: 'owner-id' };

    expect(
      canEditProject(transferred, {
        userId: 'owner-id',
        role: 'member',
        ...noCollaborator,
      }),
    ).toBe(true);
    expect(
      canEditProject(transferred, {
        userId: 'creator-id',
        role: 'member',
        ...noCollaborator,
      }),
    ).toBe(false);
  });
});
