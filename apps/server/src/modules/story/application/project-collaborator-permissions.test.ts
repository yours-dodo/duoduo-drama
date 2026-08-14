import { describe, expect, it, vi } from 'vitest';

import { SetProjectCollaboratorPermissionOverride } from './set-project-collaborator-permission-override.js';
import { UpdateProjectCollaboratorRole } from './update-project-collaborator-role.js';
import { ProjectCollaboratorPermissionOverrideNotAllowedError } from './story-errors.js';

const NOW = new Date('2026-08-10T02:00:00.000Z');

describe('project collaborator permissions', () => {
  it('updates a collaborator role and preserves the project boundary', async () => {
    const fixture = buildFixture({ collaboratorRole: 'editor' });
    const useCase = new UpdateProjectCollaboratorRole(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'owner-id',
        projectId: 'project-id',
        userId: 'writer-id',
        role: 'viewer',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({ collaborator: { role: 'viewer' } });
    expect(fixture.collaborators.updateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'team-id',
        projectId: 'project-id',
        userId: 'writer-id',
        role: 'viewer',
        updatedAt: NOW,
      }),
    );
  });

  it('allows editor archive only through an explicit allow override', async () => {
    const fixture = buildFixture({ collaboratorRole: 'editor' });
    const useCase = new SetProjectCollaboratorPermissionOverride(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'owner-id',
        projectId: 'project-id',
        userId: 'writer-id',
        permissionKey: 'project.archive',
        effect: 'allow',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      override: {
        permissionKey: 'project.archive',
        effect: 'allow',
      },
    });
    expect(fixture.collaborators.upsertPermissionOverride).toHaveBeenCalled();
  });

  it('rejects an archive allow override for a viewer', async () => {
    const fixture = buildFixture({ collaboratorRole: 'viewer' });
    const useCase = new SetProjectCollaboratorPermissionOverride(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'owner-id',
        projectId: 'project-id',
        userId: 'writer-id',
        permissionKey: 'project.archive',
        effect: 'allow',
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(
      ProjectCollaboratorPermissionOverrideNotAllowedError,
    );
  });
});

function buildFixture(options: {
  collaboratorRole: 'viewer' | 'editor' | 'manager';
}) {
  const collaborator = {
    id: 'collaborator-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    userId: 'writer-id',
    role: options.collaboratorRole,
    createdAt: NOW,
    updatedAt: NOW,
    revokedAt: null,
  };
  const fixture = {
    projects: {
      findByIdLocked: vi.fn(async () => ({
        id: 'project-id',
        tenantId: 'team-id',
        spaceId: 'team-space-id',
        createdByUserId: 'creator-id',
        ownerUserId: 'owner-id',
        title: '故事',
        visibility: 'team' as const,
        status: 'active' as const,
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    memberships: {
      findActive: vi.fn(async () => ({
        id: 'membership-id',
        tenantId: 'team-id',
        userId: 'owner-id',
        role: 'member' as const,
        joinedAt: NOW,
        removedAt: null,
      })),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => collaborator),
      listPermissionOverrides: vi.fn(async () => []),
      updateRole: vi.fn(async (value) => ({ ...collaborator, ...value })),
      upsertPermissionOverride: vi.fn(async (value) => ({
        ...value,
        updatedAt: NOW,
      })),
      removePermissionOverride: vi.fn(async () => undefined),
    },
    audit: { record: vi.fn(async () => undefined) },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    ids: { create: vi.fn(() => 'generated-id') },
  };
  return fixture;
}
