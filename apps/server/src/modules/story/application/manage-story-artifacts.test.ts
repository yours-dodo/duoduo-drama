import { describe, expect, it, vi } from 'vitest';

import { ConfirmStoryDraft } from './confirm-story-draft.js';
import { DiscardStoryDraft } from './discard-story-draft.js';
import { EditStoryDraft } from './edit-story-draft.js';
import { GetStoryArtifact } from './get-story-artifact.js';
import { ListStoryArtifacts } from './list-story-artifacts.js';
import { ListStoryVersions } from './list-story-versions.js';
import { RollbackStoryArtifact } from './rollback-story-artifact.js';
import {
  StoryArtifactVersionConflictError,
  StoryArtifactVersionStateTransitionError,
} from './story-errors.js';

const NOW = new Date('2026-08-10T04:00:00.000Z');

describe('story artifact application', () => {
  it('lists and reads artifacts with their current version for a project viewer', async () => {
    const fixture = buildFixture({
      actor: membership({ userId: 'reader-id' }),
    });

    await expect(
      new ListStoryArtifacts(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.artifacts,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'artifact-id', currentVersionId: 'draft-version-id' }],
    });

    await expect(
      new GetStoryArtifact(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.artifacts,
        fixture.versions,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
        artifactId: 'artifact-id',
      }),
    ).resolves.toMatchObject({
      artifact: { id: 'artifact-id' },
      currentVersion: { id: 'draft-version-id', status: 'draft' },
    });

    await expect(
      new ListStoryVersions(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.artifacts,
        fixture.versions,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
        artifactId: 'artifact-id',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'draft-version-id', status: 'draft' }],
    });
  });

  it('edits the current draft by creating a new immutable user version', async () => {
    const fixture = buildFixture();
    const result = await new EditStoryDraft(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.artifacts,
      fixture.versions,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    ).execute({
      tenantId: 'team-id',
      actorUserId: 'creator-id',
      projectId: 'project-id',
      artifactId: 'artifact-id',
      versionId: 'draft-version-id',
      expectedVersionNumber: 1,
      content: '  用户修改后的大纲  ',
      contentFormat: 'markdown',
      requestId: 'edit-request',
    });

    expect(result).toMatchObject({
      artifact: { currentVersionId: 'edited-version-id' },
      version: {
        id: 'edited-version-id',
        versionNumber: 2,
        content: '用户修改后的大纲',
        sourceType: 'user',
        createdByUserId: 'creator-id',
      },
    });
    expect(
      fixture.versions.items.find(
        (version) => version.id === 'draft-version-id',
      ),
    ).toMatchObject({
      id: 'draft-version-id',
      content: 'Agent 原始大纲',
      status: 'draft',
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STORY_ARTIFACT_DRAFT_EDITED' }),
    );
  });

  it('discards the current draft and restores the latest confirmed version', async () => {
    const fixture = buildFixture({
      artifact: artifact({ currentVersionId: 'draft-version-id' }),
      versions: [draftVersion(), confirmedVersion()],
    });

    const result = await new DiscardStoryDraft(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.artifacts,
      fixture.versions,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    ).execute({
      tenantId: 'team-id',
      actorUserId: 'creator-id',
      projectId: 'project-id',
      artifactId: 'artifact-id',
      versionId: 'draft-version-id',
      expectedVersionNumber: 1,
      requestId: 'discard-request',
    });

    expect(result).toMatchObject({
      artifact: { currentVersionId: 'confirmed-version-id' },
      version: { id: 'draft-version-id', status: 'discarded' },
    });
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STORY_ARTIFACT_DRAFT_DISCARDED' }),
    );
  });

  it('confirms a draft idempotently and rejects a reused key with different input', async () => {
    const fixture = buildFixture();
    const useCase = new ConfirmStoryDraft(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.artifacts,
      fixture.versions,
      fixture.idempotency,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );
    const input = {
      tenantId: 'team-id',
      actorUserId: 'creator-id',
      projectId: 'project-id',
      artifactId: 'artifact-id',
      versionId: 'draft-version-id',
      expectedVersionNumber: 1,
      idempotencyKey: 'confirm-key',
      requestId: 'confirm-request',
    };

    await expect(useCase.execute(input)).resolves.toMatchObject({
      artifact: { currentVersionId: 'draft-version-id' },
      version: { id: 'draft-version-id', status: 'confirmed' },
    });
    const auditCalls = fixture.audit.record.mock.calls.length;
    await expect(useCase.execute(input)).resolves.toMatchObject({
      version: { id: 'draft-version-id', status: 'confirmed' },
    });
    expect(fixture.audit.record).toHaveBeenCalledTimes(auditCalls);

    await expect(
      useCase.execute({ ...input, expectedVersionNumber: 2 }),
    ).rejects.toThrow('Idempotency key was already used with different input');
  });

  it('rolls back to a confirmed historical version and rejects stale pointers', async () => {
    const fixture = buildFixture({
      artifact: artifact({ currentVersionId: 'second-version-id' }),
      versions: [
        confirmedVersion({ id: 'second-version-id', versionNumber: 2 }),
        confirmedVersion(),
      ],
    });
    const useCase = new RollbackStoryArtifact(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.artifacts,
      fixture.versions,
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
        artifactId: 'artifact-id',
        targetVersionNumber: 1,
        expectedCurrentVersionNumber: 2,
        requestId: 'rollback-request',
      }),
    ).resolves.toMatchObject({
      artifact: { currentVersionId: 'confirmed-version-id' },
      version: { versionNumber: 1, status: 'confirmed' },
    });

    fixture.artifact = artifact({ currentVersionId: 'second-version-id' });
    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        artifactId: 'artifact-id',
        targetVersionNumber: 1,
        expectedCurrentVersionNumber: 1,
        requestId: 'stale-rollback-request',
      }),
    ).rejects.toBeInstanceOf(StoryArtifactVersionConflictError);
  });

  it('does not edit a confirmed version', async () => {
    const fixture = buildFixture({
      artifact: artifact({ currentVersionId: 'confirmed-version-id' }),
      versions: [confirmedVersion()],
    });

    await expect(
      new EditStoryDraft(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.artifacts,
        fixture.versions,
        fixture.audit,
        fixture.transactions,
        fixture.clock,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        artifactId: 'artifact-id',
        versionId: 'confirmed-version-id',
        expectedVersionNumber: 1,
        content: '不应覆盖确认版本',
        contentFormat: 'text',
        requestId: 'edit-confirmed-request',
      }),
    ).rejects.toBeInstanceOf(StoryArtifactVersionStateTransitionError);
  });
});

function buildFixture(
  options: {
    actor?: ReturnType<typeof membership>;
    artifact?: ReturnType<typeof artifact>;
    versions?: ReturnType<typeof draftVersion>[];
  } = {},
) {
  const fixture = {
    artifact: options.artifact ?? artifact(),
    versions: options.versions ?? [draftVersion()],
    projects: {
      findById: vi.fn(async () => project()),
      findByIdLocked: vi.fn(async () => project()),
    },
    memberships: {
      findActive: vi.fn(async () => options.actor ?? membership()),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => ({
        id: 'collaborator-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        userId: 'creator-id',
        createdAt: NOW,
      })),
    },
    artifacts: {
      findById: vi.fn(async () => fixture.artifact),
      findByIdLocked: vi.fn(async () => fixture.artifact),
      listForProject: vi.fn(async () => [fixture.artifact]),
      update: vi.fn(async (value) => {
        fixture.artifact = value;
        return value;
      }),
    },
    versions: {
      items: options.versions ?? [draftVersion()],
      findById: vi.fn(
        async ({ versionId }: { versionId: string }) =>
          fixture.versions.items.find((version) => version.id === versionId) ??
          null,
      ),
      listForArtifact: vi.fn(async () => fixture.versions.items),
      create: vi.fn(async (value) => {
        fixture.versions.items.unshift(value);
        return value;
      }),
      update: vi.fn(async (value) => {
        const index = fixture.versions.items.findIndex(
          (version) => version.id === value.id,
        );
        fixture.versions.items[index] = value;
        return value;
      }),
    },
    idempotencyRecord: null as {
      id: string;
      tenantId: string;
      scopeKey: string;
      operationType: 'CONFIRM_STORY_ARTIFACT_VERSION';
      idempotencyKey: string;
      requestHash: string;
      resultId: string;
      createdAt: Date;
    } | null,
    idempotency: {
      findLocked: vi.fn(async () => fixture.idempotencyRecord),
      create: vi.fn(async (value) => {
        fixture.idempotencyRecord = value;
        return value;
      }),
    },
    audit: { record: vi.fn(async () => undefined) },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    fingerprint: { hash: vi.fn((value: string) => `hash:${value}`) },
    ids: {
      create: vi
        .fn()
        .mockReturnValueOnce('edited-version-id')
        .mockReturnValueOnce('audit-id')
        .mockReturnValue('idempotency-id'),
    },
  };
  return fixture;
}

function project() {
  return {
    id: 'project-id',
    tenantId: 'team-id',
    spaceId: 'team-space-id',
    createdByUserId: 'creator-id',
    ownerUserId: 'creator-id',
    title: '故事',
    visibility: 'team' as const,
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function artifact(overrides: Partial<ReturnType<typeof artifact>> = {}) {
  return {
    id: 'artifact-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    type: 'outline' as const,
    title: '故事大纲',
    status: 'active' as const,
    currentVersionId: 'draft-version-id',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function draftVersion(
  overrides: Partial<ReturnType<typeof draftVersion>> = {},
) {
  return {
    id: 'draft-version-id',
    tenantId: 'team-id',
    artifactId: 'artifact-id',
    versionNumber: 1,
    content: 'Agent 原始大纲',
    contentFormat: 'markdown' as const,
    status: 'draft' as const,
    sourceType: 'agent' as const,
    sourceMessageId: 'agent-message-id',
    generationRequestId: 'generation-id',
    createdByUserId: null,
    createdAt: NOW,
    ...overrides,
  };
}

function confirmedVersion(
  overrides: Partial<ReturnType<typeof confirmedVersion>> = {},
) {
  return {
    id: 'confirmed-version-id',
    tenantId: 'team-id',
    artifactId: 'artifact-id',
    versionNumber: 1,
    content: '已确认的大纲',
    contentFormat: 'markdown' as const,
    status: 'confirmed' as const,
    sourceType: 'user' as const,
    sourceMessageId: null,
    generationRequestId: null,
    createdByUserId: 'creator-id',
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
