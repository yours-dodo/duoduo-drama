import { describe, expect, it } from 'vitest';

import type { StoryRoleAsset } from './story-api';
import { groupStoryRoleAssets } from './story-role-assets';

describe('story role asset presentation', () => {
  it('groups server-provided UUID roles by their story function', () => {
    const protagonist = role({
      id: '10000000-0000-4000-8000-000000000001',
      category: 'protagonists',
      name: '林遥',
    });
    const supporting = role({
      id: '20000000-0000-4000-8000-000000000001',
      category: 'supporting',
      name: '陈音',
    });

    const groups = groupStoryRoleAssets([supporting, protagonist]);

    expect(groups.map((group) => group.label)).toEqual([
      '主角',
      '核心角色',
      '配角',
      '背景角色',
    ]);
    expect(groups[0]?.roles).toEqual([protagonist]);
    expect(groups[2]?.roles).toEqual([supporting]);
  });

  it('does not mutate server speech arrays while grouping', () => {
    const source = role({
      id: '10000000-0000-4000-8000-000000000001',
      category: 'protagonists',
      name: '林遥',
    });
    const grouped = groupStoryRoleAssets([source]);

    grouped[0]?.roles[0]?.speechProfile.habits.push('破局者');

    expect(source.speechProfile.habits).toEqual([]);
  });
});

function role(
  input: Pick<StoryRoleAsset, 'id' | 'category' | 'name'>,
): StoryRoleAsset {
  return {
    ...input,
    tenantId: null,
    projectId: 'project-id',
    occupation: '档案修复师',
    personalityCore: '相信证据',
    motivationConflict: '想找到真相，但害怕连累家人。',
    mainlineRelation: '推动主线',
    gender: '女',
    camp: '主角方',
    appearanceFrequency: '高频',
    speechProfile: {
      style: '',
      habits: [],
      dialogueExamples: [],
    },
    coverAssetId: null,
    coverAsset: null,
    viewAssetId: null,
    viewAsset: null,
    revision: 1,
    createdByUserId: 'user-id',
    updatedByUserId: 'user-id',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
    archivedAt: null,
  };
}
