import { describe, expect, it } from 'vitest';

import {
  EMPTY_STORY_ROLE_SPEECH_PROFILE,
  StoryRoleAsset,
  StoryRoleAssetInvalidError,
  StoryRoleAssetRevisionConflictError,
} from './story-role-asset.js';

const NOW = new Date('2026-08-20T10:00:00.000Z');
const LATER = new Date('2026-08-20T11:00:00.000Z');

describe('StoryRoleAsset', () => {
  it('creates a normalized minimal role profile', () => {
    const role = StoryRoleAsset.create({
      id: 'server-generated-uuid',
      tenantId: null,
      projectId: 'project-id',
      category: 'protagonists',
      name: '  林遥  ',
      occupation: '  档案修复师  ',
      personalityCore: '  相信证据  ',
      motivationConflict: '  想找到真相，但害怕失去现有生活。  ',
      mainlineRelation: '  主视角；负责追查档案缺口。  ',
      gender: '女',
      camp: '主角方',
      appearanceFrequency: '高频',
      speechProfile: {
        style: '  语速快，喜欢反问。 ',
        habits: ['  紧张时会重复句首。 '],
        dialogueExamples: [
          { context: '被朋友拆穿时', line: '你先别急着下结论。' },
        ],
      },
      actorUserId: 'user-id',
      createdAt: NOW,
    });

    expect(role.toSnapshot()).toEqual({
      id: 'server-generated-uuid',
      tenantId: null,
      projectId: 'project-id',
      category: 'protagonists',
      name: '林遥',
      occupation: '档案修复师',
      personalityCore: '相信证据',
      motivationConflict: '想找到真相，但害怕失去现有生活。',
      mainlineRelation: '主视角；负责追查档案缺口。',
      gender: '女',
      camp: '主角方',
      appearanceFrequency: '高频',
      speechProfile: {
        style: '语速快，喜欢反问。',
        habits: ['紧张时会重复句首。'],
        dialogueExamples: [
          { context: '被朋友拆穿时', line: '你先别急着下结论。' },
        ],
      },
      coverAssetId: null,
      viewAssetId: null,
      revision: 1,
      createdByUserId: 'user-id',
      updatedByUserId: 'user-id',
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    });
  });

  it('applies defaults for optional role fields', () => {
    const role = StoryRoleAsset.create({
      id: 'role-id',
      tenantId: 'tenant-id',
      projectId: 'project-id',
      category: 'background',
      name: '路人',
      actorUserId: 'user-id',
      createdAt: NOW,
    });

    expect(role.toSnapshot()).toMatchObject({
      occupation: '',
      personalityCore: '',
      motivationConflict: '',
      mainlineRelation: '',
      gender: '未设定',
      camp: '中立',
      appearanceFrequency: '低频',
      speechProfile: EMPTY_STORY_ROLE_SPEECH_PROFILE,
    });
  });

  it('normalizes and isolates simple speech profile details', () => {
    const role = StoryRoleAsset.create({
      id: 'speech-role-id',
      tenantId: null,
      projectId: 'project-id',
      category: 'supporting',
      name: '说话的人',
      speechProfile: {
        style: '  说话很快，嘴损但不真正爆粗。 ',
        habits: [' 紧张时会结巴，但面对孩子不会。 '],
        dialogueExamples: [{ context: '被拆穿时', line: '你先别急着下结论。' }],
      },
      actorUserId: 'user-id',
      createdAt: NOW,
    });

    const snapshot = role.toSnapshot();
    expect(snapshot.speechProfile.style).toBe('说话很快，嘴损但不真正爆粗。');
    snapshot.speechProfile.habits.push('外部修改');
    expect(role.toSnapshot().speechProfile.habits).toEqual([
      '紧张时会结巴，但面对孩子不会。',
    ]);
  });

  it('rejects empty habits and dialogue lines', () => {
    expect(() =>
      StoryRoleAsset.create({
        id: 'invalid-speech-role-id',
        tenantId: null,
        projectId: 'project-id',
        category: 'supporting',
        name: '无效角色',
        speechProfile: {
          habits: ['  '],
        },
        actorUserId: 'user-id',
        createdAt: NOW,
      }),
    ).toThrow(StoryRoleAssetInvalidError);

    expect(() =>
      StoryRoleAsset.create({
        id: 'invalid-dialogue-role-id',
        tenantId: null,
        projectId: 'project-id',
        category: 'supporting',
        name: '无效角色',
        speechProfile: {
          dialogueExamples: [{ context: '', line: '  ' }],
        },
        actorUserId: 'user-id',
        createdAt: NOW,
      }),
    ).toThrow(StoryRoleAssetInvalidError);
  });

  it('updates mutable fields and advances the revision', () => {
    const role = StoryRoleAsset.restore(snapshot());

    expect(
      role.update(
        {
          name: ' 林遥（新版） ',
          motivationConflict: '想公开真相，但害怕连累家人。',
        },
        1,
        'editor-id',
        LATER,
      ),
    ).toBe(true);
    expect(role.toSnapshot()).toMatchObject({
      id: 'role-id',
      name: '林遥（新版）',
      motivationConflict: '想公开真相，但害怕连累家人。',
      revision: 2,
      updatedByUserId: 'editor-id',
      updatedAt: LATER,
    });
  });

  it('rejects stale updates and archives with a revision advance', () => {
    const role = StoryRoleAsset.restore(snapshot());

    expect(() => role.update({ name: '新版' }, 2, 'user-id', LATER)).toThrow(
      StoryRoleAssetRevisionConflictError,
    );

    expect(role.archive(1, 'user-id', LATER)).toBe(true);
    expect(role.toSnapshot()).toMatchObject({
      revision: 2,
      archivedAt: LATER,
      updatedAt: LATER,
    });
  });
});

function snapshot() {
  return {
    id: 'role-id',
    tenantId: null,
    projectId: 'project-id',
    category: 'protagonists' as const,
    name: '林遥',
    occupation: '档案修复师',
    personalityCore: '相信证据',
    motivationConflict: '想找到真相。',
    mainlineRelation: '主视角',
    gender: '女' as const,
    camp: '主角方' as const,
    appearanceFrequency: '高频' as const,
    speechProfile: EMPTY_STORY_ROLE_SPEECH_PROFILE,
    coverAssetId: null,
    viewAssetId: null,
    revision: 1,
    createdByUserId: 'user-id',
    updatedByUserId: 'user-id',
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };
}
