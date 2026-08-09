import { describe, expect, it, vi } from 'vitest';

import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { AddProjectCollaborator } from './add-project-collaborator.js';
import { ArchiveStoryProject } from './archive-story-project.js';
import { CreateStoryProject } from './create-story-project.js';
import { ListStoryProjects } from './list-story-projects.js';
import { RemoveProjectCollaborator } from './remove-project-collaborator.js';
import { UpdateStoryProject } from './update-story-project.js';
import {
  ProjectCollaboratorNotFoundError,
  StoryProjectNotFoundError,
  StoryProjectRevisionConflictError,
} from './story-errors.js';

const NOW = new Date('2026-08-10T02:00:00.000Z');

describe('story project application', () => {
  it('creates an idempotent project and records its tenant audit', async () => {
    const fixture = buildFixture();

    await expect(
      new CreateStoryProject(
        fixture.projects,
        fixture.memberships,
        fixture.idempotency,
        fixture.audit,
        fixture.transactions,
        fixture.clock,
        fixture.fingerprint,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        title: '  我的故事  ',
        visibility: 'private',
        idempotencyKey: 'project-key',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      project: {
        id: 'project-id',
        title: '我的故事',
        visibility: 'private',
        status: 'active',
        revision: 1,
      },
    });
    expect(fixture.projects.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'team-id',
        createdByUserId: 'creator-id',
        title: '我的故事',
        visibility: 'private',
      }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STORY_PROJECT_CREATED',
        targetType: 'STORY_PROJECT',
        targetId: 'project-id',
      }),
    );
  });

  it('lists projects through the repository visibility boundary', async () => {
    const fixture = buildFixture({
      projectPage: {
        items: [projectSnapshot({ visibility: 'team' })],
        next: null,
      },
    });

    await expect(
      new ListStoryProjects(fixture.projects, fixture.memberships).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        page: { limit: 25, after: null },
      }),
    ).resolves.toMatchObject({
      items: [
        { id: 'project-id', canEdit: false, canManageCollaborators: false },
      ],
      next: null,
    });
    expect(fixture.projects.listVisible).toHaveBeenCalledWith({
      tenantId: 'team-id',
      actorUserId: 'reader-id',
      actorRole: 'member',
      page: { limit: 25, after: null },
    });
  });

  it('allows a collaborator to edit, but rejects a stale revision', async () => {
    const fixture = buildFixture({
      actor: membership({ userId: 'writer-id', role: 'member' }),
      project: projectSnapshot({}),
      collaborator: collaboratorSnapshot({ userId: 'writer-id' }),
    });
    const useCase = new UpdateStoryProject(
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
        actorUserId: 'writer-id',
        projectId: 'project-id',
        title: '新标题',
        expectedRevision: 1,
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({ project: { title: '新标题', revision: 2 } });

    fixture.project = projectSnapshot({ revision: 2 });
    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'writer-id',
        projectId: 'project-id',
        title: '冲突标题',
        expectedRevision: 1,
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(StoryProjectRevisionConflictError);
  });

  it('makes a project private by revoking collaborators atomically', async () => {
    const fixture = buildFixture({
      project: projectSnapshot({}),
      collaborator: collaboratorSnapshot({ userId: 'writer-id' }),
    });
    const useCase = new UpdateStoryProject(
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
        actorUserId: 'creator-id',
        projectId: 'project-id',
        visibility: 'private',
        expectedRevision: 1,
        requestId: 'private-request',
      }),
    ).resolves.toMatchObject({ project: { visibility: 'private' } });
    expect(fixture.collaborators.removeAll).toHaveBeenCalledWith({
      tenantId: 'team-id',
      projectId: 'project-id',
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STORY_PROJECT_VISIBILITY_CHANGED',
        beforeSummary: expect.objectContaining({ visibility: 'team' }),
        afterSummary: expect.objectContaining({ visibility: 'private' }),
      }),
    );
  });

  it('archives a project only for an editor and hides missing projects', async () => {
    const fixture = buildFixture({
      project: projectSnapshot({}),
      actor: membership({ userId: 'reader-id', role: 'member' }),
    });
    await expect(
      new ArchiveStoryProject(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.audit,
        fixture.transactions,
        fixture.clock,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
        expectedRevision: 1,
        requestId: 'request-id',
      }),
    ).rejects.toThrow(StoryProjectNotFoundError);

    fixture.project = null;
    await expect(
      new ArchiveStoryProject(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.audit,
        fixture.transactions,
        fixture.clock,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'missing-project-id',
        expectedRevision: 1,
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(StoryProjectNotFoundError);
  });

  it('lets the project creator manage collaborators and audits the change', async () => {
    const fixture = buildFixture({
      project: projectSnapshot({}),
      targetMembership: membership({ userId: 'writer-id', role: 'member' }),
    });
    const add = new AddProjectCollaborator(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );
    await expect(
      add.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        userId: 'writer-id',
        requestId: 'add-request',
      }),
    ).resolves.toMatchObject({ collaborator: { userId: 'writer-id' } });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STORY_PROJECT_COLLABORATOR_ADDED' }),
    );

    const remove = new RemoveProjectCollaborator(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );
    await expect(
      remove.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        userId: 'writer-id',
        requestId: 'remove-request',
      }),
    ).resolves.toBeUndefined();
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STORY_PROJECT_COLLABORATOR_REMOVED' }),
    );
  });

  it('does not expose a missing collaborator as a cross-tenant resource', async () => {
    const fixture = buildFixture({
      project: projectSnapshot({}),
      collaborator: null,
    });
    await expect(
      new RemoveProjectCollaborator(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.audit,
        fixture.transactions,
        fixture.clock,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        userId: 'writer-id',
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(ProjectCollaboratorNotFoundError);
  });
});

function projectSnapshot(
  overrides: Partial<ReturnType<typeof projectSnapshot>> = {},
) {
  return {
    id: 'project-id',
    tenantId: 'team-id',
    createdByUserId: 'creator-id',
    title: '故事',
    visibility: 'team' as const,
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function collaboratorSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'collaborator-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    userId: 'writer-id',
    createdAt: NOW,
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-id',
    tenantId: 'team-id',
    userId: 'creator-id',
    role: 'member' as const,
    joinedAt: NOW,
    removedAt: null,
    ...overrides,
  };
}

function buildFixture(
  options: {
    actor?: ReturnType<typeof membership>;
    project?: ReturnType<typeof projectSnapshot> | null;
    projectPage?: { items: ReturnType<typeof projectSnapshot>[]; next: null };
    collaborator?: ReturnType<typeof collaboratorSnapshot> | null;
    targetMembership?: ReturnType<typeof membership> | null;
  } = {},
) {
  const fixture = {
    project:
      options.project === undefined ? projectSnapshot() : options.project,
    collaborator:
      options.collaborator === undefined ? null : options.collaborator,
    projects: {
      create: vi.fn(async (value) => value),
      update: vi.fn(async (value) => value),
      findById: vi.fn(async () => fixture.project),
      findByIdLocked: vi.fn(async () => fixture.project),
      listVisible: vi.fn(
        async () =>
          options.projectPage ?? { items: [projectSnapshot()], next: null },
      ),
    },
    memberships: {
      findActive: vi.fn(async () => options.actor ?? membership()),
    },
    collaborators: {
      find: vi.fn(async () => fixture.collaborator),
      findByProjectAndUserLocked: vi.fn(async () => fixture.collaborator),
      create: vi.fn(async (value) => {
        fixture.collaborator = value;
        return value;
      }),
      remove: vi.fn(async () => {
        fixture.collaborator = null;
      }),
      removeAll: vi.fn(async () => 1),
    },
    targetMembership:
      options.targetMembership === undefined
        ? membership({ userId: 'writer-id' })
        : options.targetMembership,
    idempotency: {
      findLocked: vi.fn(async () => null),
      create: vi.fn(async (value) => value),
    },
    audit: {
      record: vi.fn(async () => undefined),
    } as AuditRepository & { record: ReturnType<typeof vi.fn> },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    fingerprint: { hash: vi.fn(() => 'request-hash') },
    ids: {
      create: vi
        .fn()
        .mockReturnValueOnce('project-id')
        .mockReturnValueOnce('idempotency-id')
        .mockReturnValue('audit-id'),
    },
  };
  fixture.memberships.findActive.mockImplementation(
    async ({ userId }: { userId: string }) => {
      if (userId === 'writer-id' && fixture.targetMembership !== null) {
        return fixture.targetMembership;
      }
      return options.actor ?? membership();
    },
  );
  return fixture;
}
