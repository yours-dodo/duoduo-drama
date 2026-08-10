import { describe, expect, it } from 'vitest';

import {
  StoryArtifact,
  StoryArtifactTitleInvalidError,
  StoryArtifactTypeInvalidError,
} from './story-artifact.js';

const CREATED_AT = new Date('2026-08-10T00:00:00.000Z');

describe('StoryArtifact', () => {
  it('creates an active artifact without a current version', () => {
    const artifact = StoryArtifact.create({
      id: 'artifact-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      type: 'outline',
      title: '  故事大纲  ',
      createdAt: CREATED_AT,
    });

    expect(artifact.toSnapshot()).toEqual({
      id: 'artifact-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      type: 'outline',
      title: '故事大纲',
      status: 'active',
      currentVersionId: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('rejects an unknown type or invalid title', () => {
    expect(() =>
      StoryArtifact.create({
        id: 'artifact-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        type: 'unknown' as never,
        title: '故事大纲',
        createdAt: CREATED_AT,
      }),
    ).toThrow(StoryArtifactTypeInvalidError);

    expect(() =>
      StoryArtifact.create({
        id: 'artifact-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        type: 'outline',
        title: '   ',
        createdAt: CREATED_AT,
      }),
    ).toThrow(StoryArtifactTitleInvalidError);
  });

  it('returns an isolated snapshot', () => {
    const artifact = StoryArtifact.create({
      id: 'artifact-id',
      tenantId: 'team-id',
      projectId: 'project-id',
      type: 'outline',
      title: '故事大纲',
      createdAt: CREATED_AT,
    });

    const snapshot = artifact.toSnapshot();
    snapshot.title = '被修改的副本';
    snapshot.createdAt.setFullYear(2030);

    expect(artifact.toSnapshot()).toMatchObject({
      title: '故事大纲',
      createdAt: CREATED_AT,
    });
  });

  it('rejects unknown persisted status', () => {
    expect(() =>
      StoryArtifact.restore({
        id: 'artifact-id',
        tenantId: 'team-id',
        projectId: 'project-id',
        type: 'outline',
        title: '故事大纲',
        status: 'published' as never,
        currentVersionId: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      }),
    ).toThrow();
  });
});
