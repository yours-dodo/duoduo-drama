import { describe, expect, it } from 'vitest';

import {
  StoryProject,
  StoryProjectArchivedError,
  StoryProjectRevisionConflictError,
  StoryProjectEraInvalidError,
  StoryProjectPurgeUnavailableError,
} from './story-project.js';

const CREATED_AT = new Date('2026-08-10T00:00:00.000Z');
const UPDATED_AT = new Date('2026-08-10T01:00:00.000Z');

describe('StoryProject', () => {
  it('creates a team-visible project at revision one', () => {
    const project = StoryProject.create({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '  我的故事  ',
      creationMode: 'standard',
      visibility: 'team',
      createdAt: CREATED_AT,
    });

    expect(project.toSnapshot()).toEqual({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '我的故事',
      creationMode: 'standard',
      visibility: 'team',
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('updates title and visibility only from the expected revision', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '旧标题',
      creationMode: 'standard',
      visibility: 'team',
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 3,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(() =>
      project.update({ title: '新标题', visibility: 'private' }, 2, UPDATED_AT),
    ).toThrow(StoryProjectRevisionConflictError);

    expect(
      project.update({ title: '新标题', visibility: 'private' }, 3, UPDATED_AT),
    ).toBe(true);
    expect(project.toSnapshot()).toMatchObject({
      title: '新标题',
      visibility: 'private',
      revision: 4,
      updatedAt: UPDATED_AT,
    });
  });

  it('archives an active project and rejects later edits', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '故事',
      creationMode: 'standard',
      visibility: 'team',
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(() => project.archive(2, UPDATED_AT)).toThrow(
      StoryProjectRevisionConflictError,
    );
    expect(project.toSnapshot().status).toBe('active');
    expect(project.archive(1, UPDATED_AT)).toBe(true);
    expect(project.toSnapshot()).toMatchObject({
      status: 'archived',
      revision: 2,
      updatedAt: UPDATED_AT,
    });
    expect(() => project.update({ title: '不能修改' }, 2, UPDATED_AT)).toThrow(
      StoryProjectArchivedError,
    );
  });

  it('keeps an era present and only accepts modern or ancient', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: null,
      spaceId: 'personal-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '故事',
      creationMode: 'standard',
      visibility: 'private',
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    expect(project.update({ era: '古代' }, 1, UPDATED_AT)).toBe(true);
    expect(project.toSnapshot().era).toBe('古代');
    expect(project.update({ era: undefined }, 2, UPDATED_AT)).toBe(false);
    expect(() =>
      project.update({ era: '未来' as never }, 2, UPDATED_AT),
    ).toThrow(StoryProjectEraInvalidError);
  });

  it('restores an archived project before the retention deadline', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '故事',
      creationMode: 'standard',
      visibility: 'team',
      status: 'archived',
      archivedAt: UPDATED_AT,
      purgeAt: new Date('2026-09-09T01:00:00.000Z'),
      purgeStartedAt: null,
      revision: 2,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    expect(
      project.restoreFromArchive(2, new Date('2026-08-20T00:00:00.000Z')),
    ).toBe(true);
    expect(project.toSnapshot()).toMatchObject({
      status: 'active',
      archivedAt: null,
      purgeAt: null,
      purgeStartedAt: null,
      revision: 3,
    });
  });

  it('rejects restoring an expired or claimed project', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: 'team-id',
      spaceId: 'team-space-id',
      createdByUserId: 'creator-id',
      ownerUserId: 'creator-id',
      title: '故事',
      creationMode: 'standard',
      visibility: 'team',
      status: 'archived',
      archivedAt: UPDATED_AT,
      purgeAt: UPDATED_AT,
      purgeStartedAt: null,
      revision: 2,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    expect(() =>
      project.restoreFromArchive(2, new Date('2026-08-20T00:00:00.000Z')),
    ).toThrow(StoryProjectPurgeUnavailableError);
  });
});
