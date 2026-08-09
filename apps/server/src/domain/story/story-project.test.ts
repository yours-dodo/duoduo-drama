import { describe, expect, it } from 'vitest';

import {
  StoryProject,
  StoryProjectArchivedError,
  StoryProjectRevisionConflictError,
} from './story-project.js';

const CREATED_AT = new Date('2026-08-10T00:00:00.000Z');
const UPDATED_AT = new Date('2026-08-10T01:00:00.000Z');

describe('StoryProject', () => {
  it('creates a team-visible project at revision one', () => {
    const project = StoryProject.create({
      id: 'project-id',
      tenantId: 'team-id',
      createdByUserId: 'creator-id',
      title: '  我的故事  ',
      visibility: 'team',
      createdAt: CREATED_AT,
    });

    expect(project.toSnapshot()).toEqual({
      id: 'project-id',
      tenantId: 'team-id',
      createdByUserId: 'creator-id',
      title: '我的故事',
      visibility: 'team',
      status: 'active',
      revision: 1,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('updates title and visibility only from the expected revision', () => {
    const project = StoryProject.restore({
      id: 'project-id',
      tenantId: 'team-id',
      createdByUserId: 'creator-id',
      title: '旧标题',
      visibility: 'team',
      status: 'active',
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
      createdByUserId: 'creator-id',
      title: '故事',
      visibility: 'team',
      status: 'active',
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
});
