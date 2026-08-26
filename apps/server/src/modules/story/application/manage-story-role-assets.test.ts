import { describe, expect, it, vi } from 'vitest';

import {
  StoryRoleAsset,
  StoryRoleAssetRevisionConflictError,
  type StoryRoleAssetSnapshot,
} from '../../../domain/story/story-role-asset.js';
import { ArchiveStoryRoleAsset } from './archive-story-role-asset.js';
import { CreateStoryRoleAsset } from './create-story-role-asset.js';
import { ListStoryRoleAssets } from './list-story-role-assets.js';
import {
  StoryRoleAssetCoverAssetInvalidError,
  StoryRoleAssetInUseError,
  StoryRoleAssetViewAssetInvalidError,
} from './story-errors.js';
import { UpdateStoryRoleAsset } from './update-story-role-asset.js';

const NOW = new Date('2026-08-20T10:00:00.000Z');
const LATER = new Date('2026-08-20T11:00:00.000Z');

describe('story role asset application use cases', () => {
  it('creates a role with a generated id, idempotency record, and audit', async () => {
    const fixture = buildFixture();
    const useCase = new CreateStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.idempotency,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        category: 'protagonists',
        name: '林遥',
        occupation: '档案修复师',
        idempotencyKey: 'create-role-key',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      roleAsset: {
        id: 'role-id',
        projectId: 'project-id',
        name: '林遥',
        revision: 1,
      },
    });
    expect(fixture.roles.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'role-id', tenantId: null }),
    );
    expect(fixture.idempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: 'CREATE_STORY_ROLE_ASSET',
        resultId: 'role-id',
      }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STORY_ROLE_ASSET_CREATED',
        targetId: 'role-id',
      }),
    );
  });

  it('lists roles inside the authorized project scope', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    const useCase = new ListStoryRoleAssets(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
      }),
    ).resolves.toMatchObject({
      items: [{ id: 'existing-role-id', name: '林遥' }],
    });
    expect(fixture.roles.listByProject).toHaveBeenCalledWith({
      tenantId: null,
      projectId: 'project-id',
    });
  });

  it('updates a role and rejects stale revisions', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    const useCase = new UpdateStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.audit,
      fixture.transactions,
      { now: vi.fn(async () => LATER) },
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        name: '林遥（新版）',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      roleAsset: { name: '林遥（新版）', revision: 2 },
    });

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        name: '再次更新',
        requestId: 'request-id-2',
      }),
    ).rejects.toBeInstanceOf(StoryRoleAssetRevisionConflictError);
  });

  it('ignores undefined optional fields from transformed HTTP DTOs', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    const useCase = new UpdateStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        category: undefined,
        name: undefined,
        occupation: undefined,
        personalityCore: undefined,
        motivationConflict: undefined,
        mainlineRelation: undefined,
        gender: undefined,
        camp: undefined,
        appearanceFrequency: undefined,
        speechProfile: undefined,
        coverAssetId: undefined,
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      roleAsset: { id: 'existing-role-id', name: '林遥', revision: 1 },
    });
    expect(fixture.roles.update).not.toHaveBeenCalled();
  });

  it('binds only an uploaded image asset from the same project', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    fixture.assets.findById.mockResolvedValue({
      id: 'cover-asset-id',
      tenantId: null,
      projectId: 'project-id',
      uploadedByUserId: 'user-id',
      objectKey: 'personal/story-projects/project-id/assets/cover/original',
      originalFileName: 'cover.png',
      contentType: 'image/png',
      byteSize: 2048,
      checksum: null,
      status: 'uploaded',
      uploadExpiresAt: NOW,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new UpdateStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
      {
        assets: fixture.assets as never,
        objectStorage: fixture.objectStorage as never,
        objectStorageConfig: { presignedUrlTtlSeconds: 600 },
      },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        coverAssetId: 'cover-asset-id',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      roleAsset: {
        coverAssetId: 'cover-asset-id',
        coverAsset: {
          id: 'cover-asset-id',
          downloadUrl: 'https://cdn.test/cover',
        },
      },
    });
    expect(fixture.roles.update).toHaveBeenCalledWith(
      expect.objectContaining({ coverAssetId: 'cover-asset-id' }),
    );

    fixture.assets.findById.mockResolvedValue(null);
    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 2,
        coverAssetId: 'missing-asset-id',
        requestId: 'request-id-2',
      }),
    ).rejects.toBeInstanceOf(StoryRoleAssetCoverAssetInvalidError);
  });

  it('binds a view image asset from the same project', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    fixture.assets.findById.mockResolvedValue({
      id: 'view-asset-id',
      tenantId: null,
      projectId: 'project-id',
      uploadedByUserId: 'user-id',
      objectKey: 'personal/story-projects/project-id/assets/view/original',
      originalFileName: 'view.webp',
      contentType: 'image/webp',
      byteSize: 4096,
      checksum: null,
      status: 'uploaded',
      uploadExpiresAt: NOW,
      completedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new UpdateStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
      {
        assets: fixture.assets as never,
        objectStorage: fixture.objectStorage as never,
        objectStorageConfig: { presignedUrlTtlSeconds: 600 },
      },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        viewAssetId: 'view-asset-id',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      roleAsset: {
        viewAssetId: 'view-asset-id',
        viewAsset: {
          id: 'view-asset-id',
          originalFileName: 'view.webp',
          downloadUrl: 'https://cdn.test/cover',
        },
      },
    });
    expect(fixture.roles.update).toHaveBeenCalledWith(
      expect.objectContaining({ viewAssetId: 'view-asset-id' }),
    );

    fixture.assets.findById.mockResolvedValue(null);
    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 2,
        viewAssetId: 'missing-view-asset-id',
        requestId: 'request-id-2',
      }),
    ).rejects.toBeInstanceOf(StoryRoleAssetViewAssetInvalidError);
  });

  it('refuses to archive a referenced role', async () => {
    const fixture = buildFixture([roleSnapshot()]);
    fixture.references.hasReferences.mockResolvedValue(true);
    const useCase = new ArchiveStoryRoleAsset(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.roles,
      fixture.references,
      fixture.audit,
      fixture.transactions,
      fixture.clock,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-id',
        projectId: 'project-id',
        roleId: 'existing-role-id',
        expectedRevision: 1,
        requestId: 'request-id',
      }),
    ).rejects.toBeInstanceOf(StoryRoleAssetInUseError);
    expect(fixture.roles.update).not.toHaveBeenCalled();
  });
});

function buildFixture(initialRoles: StoryRoleAssetSnapshot[] = []) {
  const values = new Map(initialRoles.map((role) => [role.id, role]));
  const project = {
    id: 'project-id',
    tenantId: null,
    spaceId: 'personal-space-id',
    spaceKind: 'personal' as const,
    createdByUserId: 'user-id',
    ownerUserId: 'user-id',
    title: '未命名故事',
    creationMode: 'standard' as const,
    visibility: 'private' as const,
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const roles = {
    create: vi.fn(async (role: StoryRoleAssetSnapshot) => {
      values.set(role.id, role);
      return role;
    }),
    update: vi.fn(async (role: StoryRoleAssetSnapshot) => {
      values.set(role.id, role);
      return role;
    }),
    findById: vi.fn(
      async (request: { roleId: string }) => values.get(request.roleId) ?? null,
    ),
    findByIdLocked: vi.fn(
      async (request: { roleId: string }) => values.get(request.roleId) ?? null,
    ),
    listByProject: vi.fn(async () => [...values.values()]),
  };
  return {
    projects: {
      findById: vi.fn(async () => project),
      findByIdLocked: vi.fn(async () => project),
      create: vi.fn(),
      update: vi.fn(),
      listVisible: vi.fn(),
    },
    memberships: {
      findActive: vi.fn(async () => null),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => null),
    },
    roles,
    references: { hasReferences: vi.fn(async () => false) },
    idempotency: {
      findLocked: vi.fn(async () => null),
      create: vi.fn(async (value) => value),
    },
    audit: { record: vi.fn(async () => undefined) },
    transactions: {
      run: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    },
    clock: { now: vi.fn(async () => NOW) },
    fingerprint: { hash: vi.fn(() => 'request-hash') },
    ids: {
      create: vi
        .fn()
        .mockReturnValueOnce('role-id')
        .mockReturnValueOnce('idempotency-id')
        .mockReturnValue('audit-id'),
    },
    assets: {
      findById: vi.fn(),
    },
    objectStorage: {
      createDownloadUrl: vi.fn().mockResolvedValue({
        url: 'https://cdn.test/cover',
        expiresAt: '2026-08-20T10:10:00.000Z',
      }),
    },
  };
}

function roleSnapshot(): StoryRoleAssetSnapshot {
  return StoryRoleAsset.create({
    id: 'existing-role-id',
    tenantId: null,
    projectId: 'project-id',
    category: 'protagonists',
    name: '林遥',
    actorUserId: 'user-id',
    createdAt: NOW,
  }).toSnapshot();
}
