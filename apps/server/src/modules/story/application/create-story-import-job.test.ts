import { describe, expect, it, vi } from 'vitest';

import { CreateStoryImportJob } from './create-story-import-job.js';

const NOW = new Date('2026-08-15T05:00:00.000Z');

describe('CreateStoryImportJob', () => {
  it('records a personal-space import job and its audit atomically', async () => {
    const fixture = buildFixture();
    const useCase = new CreateStoryImportJob(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.importJobs,
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
        fileName: '旧故事.md',
        contentType: 'text/markdown',
        byteSize: 2048,
        idempotencyKey: 'import-key',
        requestId: 'request-id',
      }),
    ).resolves.toMatchObject({
      importJob: {
        id: 'import-id',
        tenantId: null,
        projectId: 'project-id',
        sourceFileName: '旧故事.md',
        status: 'pending',
      },
    });
    expect(fixture.importJobs.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'import-id', status: 'pending' }),
    );
    expect(fixture.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'STORY_IMPORT_JOB_CREATED',
        targetId: 'import-id',
      }),
    );
  });
});

function buildFixture() {
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
  return {
    projects: {
      findById: vi.fn(async () => project),
      findByIdLocked: vi.fn(async () => project),
    },
    memberships: { findActive: vi.fn(async () => null) },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => null),
    },
    importJobs: {
      create: vi.fn(async (value) => value),
      findById: vi.fn(async () => null),
    },
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
        .mockReturnValueOnce('import-id')
        .mockReturnValueOnce('idempotency-id')
        .mockReturnValue('audit-id'),
    },
  };
}
