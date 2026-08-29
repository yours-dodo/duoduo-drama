import { describe, expect, it, vi } from 'vitest';

import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import { StoryArtifactVersion } from '../../../domain/story/story-artifact-version.js';
import { StoryProject } from '../../../domain/story/story-project.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import { SaveStoryOutline } from './save-story-outline.js';
import {
  StoryArtifactVersionConflictError,
  StoryOutlineContentInvalidError,
} from './story-errors.js';

const NOW = new Date('2026-08-23T04:00:00.000Z');
const CONTENT = JSON.stringify({
  schemaVersion: 'narrative-planning.v1',
  rootStoryId: 'story-1',
  story: {
    id: 'story-1',
    type: 'story',
    title: '故事',
    summary: '',
    arcIds: [],
  },
  arcs: [],
  chapters: [],
  beats: [],
  assets: [],
});

describe('SaveStoryOutline', () => {
  it('rejects content outside the normalized narrative document contract', async () => {
    const useCase = new SaveStoryOutline(
      {} as StoryProjectRepository,
      {} as TeamMembershipRepository,
      {} as ProjectCollaboratorRepository,
      {} as StoryArtifactRepository,
      {} as StoryArtifactVersionRepository,
      {} as IdempotencyRepository,
      {} as AuditRepository,
      { run: vi.fn() },
      { now: vi.fn() },
      { hash: vi.fn() },
      { create: vi.fn() },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: 'project-1',
        content: '{"schemaVersion":"wrong"}',
        idempotencyKey: 'invalid-key',
        requestId: 'request-1',
      }),
    ).rejects.toBeInstanceOf(StoryOutlineContentInvalidError);

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: 'project-1',
        content: JSON.stringify({
          schemaVersion: 'narrative-planning.v1',
          rootStoryId: 'story-1',
          story: {
            id: 'story-1',
            type: 'story',
            title: '故事',
            summary: '',
            arcIds: 'not-an-array',
          },
          arcs: [],
          chapters: [],
          beats: [],
          assets: [],
        }),
        idempotencyKey: 'invalid-shape-key',
        requestId: 'request-2',
      }),
    ).rejects.toBeInstanceOf(StoryOutlineContentInvalidError);
  });

  it('creates latest plus one for every autosave and protects against stale autosaves', async () => {
    const project = StoryProject.create({
      id: 'project-1',
      tenantId: null,
      spaceId: 'space-1',
      spaceKind: 'personal',
      createdByUserId: 'user-1',
      ownerUserId: 'user-1',
      title: '故事',
      creationMode: 'standard',
      visibility: 'private',
      createdAt: NOW,
    }).toSnapshot();
    const artifact = StoryArtifact.create({
      id: 'artifact-1',
      tenantId: null,
      projectId: project.id,
      type: 'outline',
      title: '大纲',
      createdAt: NOW,
    }).toSnapshot();
    const current = StoryArtifactVersion.createDraft({
      id: 'version-1',
      tenantId: null,
      artifactId: artifact.id,
      versionNumber: 1,
      content: CONTENT,
      contentFormat: 'json',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-1',
      createdAt: NOW,
    }).toSnapshot();
    artifact.currentVersionId = current.id;
    const latest = StoryArtifactVersion.createDraft({
      id: 'version-3',
      tenantId: null,
      artifactId: artifact.id,
      versionNumber: 3,
      content: CONTENT,
      contentFormat: 'json',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-1',
      createdAt: NOW,
    }).toSnapshot();
    const updatedContent = JSON.stringify({
      schemaVersion: 'narrative-planning.v1',
      rootStoryId: 'story-1',
      story: {
        id: 'story-1',
        type: 'story',
        title: '故事',
        summary: '',
        arcIds: [],
      },
      arcs: [],
      chapters: [],
      beats: [],
      assets: [],
      updated: true,
    });
    const versions = {
      listForArtifact: vi.fn().mockResolvedValue([current, latest]),
      update: vi.fn().mockImplementation(async (version) => version),
      create: vi.fn(),
      findById: vi.fn(),
    } as unknown as StoryArtifactVersionRepository;
    const artifacts = {
      findActiveForProjectAndTypeLocked: vi.fn().mockResolvedValue(artifact),
      update: vi.fn().mockImplementation(async (value) => value),
    } as unknown as StoryArtifactRepository;
    const projects = {
      findByIdLocked: vi.fn().mockResolvedValue(project),
    } as unknown as StoryProjectRepository;
    const collaborators = {
      findByProjectAndUserLocked: vi.fn(),
    } as unknown as ProjectCollaboratorRepository;
    const idempotency = {
      findLocked: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    } as unknown as IdempotencyRepository;
    const useCase = new SaveStoryOutline(
      projects,
      {} as TeamMembershipRepository,
      collaborators,
      artifacts,
      versions,
      idempotency,
      { record: vi.fn() } as unknown as AuditRepository,
      { run: async <T>(operation: () => Promise<T>) => operation() },
      { now: async () => NOW },
      { hash: (value: string) => value },
      { create: vi.fn().mockReturnValue('new-id') },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: project.id,
        content: updatedContent,
        expectedVersionNumber: 1,
        idempotencyKey: 'save-key-1',
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      artifact: { currentVersionId: 'new-id' },
      version: {
        id: 'new-id',
        versionNumber: 4,
        content: updatedContent,
      },
    });

    expect(versions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-id',
        versionNumber: 4,
        content: updatedContent,
      }),
    );
    expect(versions.update).not.toHaveBeenCalled();
    expect(artifacts.update).toHaveBeenCalledWith(
      expect.objectContaining({ currentVersionId: 'new-id' }),
    );
    expect(idempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        resultId: 'new-id',
        idempotencyKey: 'save-key-1',
      }),
    );

    expect(
      (idempotency as unknown as { create: ReturnType<typeof vi.fn> }).create
        .mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      (versions as unknown as { create: ReturnType<typeof vi.fn> }).create.mock
        .invocationCallOrder[0]!,
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: project.id,
        content: updatedContent,
        expectedVersionNumber: 0,
        idempotencyKey: 'save-key-2',
        requestId: 'request-2',
      }),
    ).rejects.toBeInstanceOf(StoryArtifactVersionConflictError);
  });

  it('allows only one client to create the first outline version from expectation zero', async () => {
    const project = StoryProject.create({
      id: 'project-first-save',
      tenantId: null,
      spaceId: 'space-1',
      spaceKind: 'personal',
      createdByUserId: 'user-1',
      ownerUserId: 'user-1',
      title: '故事',
      creationMode: 'standard',
      visibility: 'private',
      createdAt: NOW,
    }).toSnapshot();
    let artifact = StoryArtifact.create({
      id: 'artifact-first-save',
      tenantId: null,
      projectId: project.id,
      type: 'outline',
      title: '大纲',
      createdAt: NOW,
    }).toSnapshot();
    const storedVersions: ReturnType<StoryArtifactVersion['toSnapshot']>[] = [];
    const versions = {
      listForArtifact: vi.fn(async () => [...storedVersions]),
      create: vi.fn(async (version) => {
        storedVersions.push(version);
      }),
      findById: vi.fn(),
      update: vi.fn(),
    } as unknown as StoryArtifactVersionRepository;
    const artifacts = {
      findActiveForProjectAndTypeLocked: vi.fn(async () => artifact),
      update: vi.fn(async (value) => {
        artifact = value;
        return value;
      }),
    } as unknown as StoryArtifactRepository;
    const useCase = new SaveStoryOutline(
      {
        findByIdLocked: vi.fn().mockResolvedValue(project),
      } as unknown as StoryProjectRepository,
      {} as TeamMembershipRepository,
      {
        findByProjectAndUserLocked: vi.fn(),
      } as unknown as ProjectCollaboratorRepository,
      artifacts,
      versions,
      {
        findLocked: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      } as unknown as IdempotencyRepository,
      { record: vi.fn() } as unknown as AuditRepository,
      { run: async <T>(operation: () => Promise<T>) => operation() },
      { now: async () => NOW },
      { hash: (value: string) => value },
      {
        create: vi
          .fn()
          .mockReturnValueOnce('version-first')
          .mockReturnValueOnce('idempotency-first')
          .mockReturnValueOnce('audit-first'),
      },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: project.id,
        content: CONTENT,
        expectedVersionNumber: 0,
        idempotencyKey: 'first-client',
        requestId: 'request-first',
      }),
    ).resolves.toMatchObject({ version: { versionNumber: 1 } });

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: project.id,
        content: CONTENT,
        expectedVersionNumber: 0,
        idempotencyKey: 'second-client',
        requestId: 'request-second',
      }),
    ).rejects.toBeInstanceOf(StoryArtifactVersionConflictError);
    expect(versions.create).toHaveBeenCalledTimes(1);
  });

  it('returns the original created version for an idempotent retry', async () => {
    const project = StoryProject.create({
      id: 'project-1',
      tenantId: null,
      spaceId: 'space-1',
      spaceKind: 'personal',
      createdByUserId: 'user-1',
      ownerUserId: 'user-1',
      title: '故事',
      creationMode: 'standard',
      visibility: 'private',
      createdAt: NOW,
    }).toSnapshot();
    const artifact = StoryArtifact.create({
      id: 'artifact-1',
      tenantId: null,
      projectId: project.id,
      type: 'outline',
      title: '大纲',
      createdAt: NOW,
    }).toSnapshot();
    const version = StoryArtifactVersion.createDraft({
      id: 'version-2',
      tenantId: null,
      artifactId: artifact.id,
      versionNumber: 2,
      content: CONTENT,
      contentFormat: 'json',
      sourceType: 'user',
      sourceMessageId: null,
      generationRequestId: null,
      createdByUserId: 'user-1',
      createdAt: NOW,
    }).toSnapshot();
    artifact.currentVersionId = version.id;
    const requestHash = JSON.stringify({
      projectId: project.id,
      content: CONTENT,
      expectedVersionNumber: 2,
    });
    const versions = {
      findById: vi.fn().mockResolvedValue(version),
      listForArtifact: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as StoryArtifactVersionRepository;
    const useCase = new SaveStoryOutline(
      {
        findByIdLocked: vi.fn().mockResolvedValue(project),
      } as unknown as StoryProjectRepository,
      {} as TeamMembershipRepository,
      {
        findByProjectAndUserLocked: vi.fn(),
      } as unknown as ProjectCollaboratorRepository,
      {
        findActiveForProjectAndTypeLocked: vi.fn().mockResolvedValue(artifact),
        update: vi.fn(),
      } as unknown as StoryArtifactRepository,
      versions,
      {
        findLocked: vi.fn().mockResolvedValue({
          requestHash,
          resultId: version.id,
        }),
        create: vi.fn(),
      } as unknown as IdempotencyRepository,
      { record: vi.fn() } as unknown as AuditRepository,
      { run: async <T>(operation: () => Promise<T>) => operation() },
      { now: async () => NOW },
      { hash: (value: string) => value },
      { create: vi.fn() },
    );

    await expect(
      useCase.execute({
        tenantId: null,
        actorUserId: 'user-1',
        projectId: project.id,
        content: CONTENT,
        expectedVersionNumber: 2,
        idempotencyKey: 'save-key-1',
        requestId: 'request-1',
      }),
    ).resolves.toMatchObject({
      version: { id: 'version-2', versionNumber: 2 },
    });

    expect(versions.findById).toHaveBeenCalledWith({
      tenantId: null,
      versionId: 'version-2',
    });
    expect(versions.listForArtifact).not.toHaveBeenCalled();
    expect(versions.create).not.toHaveBeenCalled();
    expect(versions.update).not.toHaveBeenCalled();
  });
});
