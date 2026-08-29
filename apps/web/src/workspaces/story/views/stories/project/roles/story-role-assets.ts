import type {
  StoryRoleAsset,
  StoryRoleCamp,
  StoryRoleCategory,
  StoryRoleAppearanceFrequency,
  StoryRoleGender,
} from '../../../../api/story-api';

export const storyRoleCategoryOptions: ReadonlyArray<{
  value: StoryRoleCategory;
  label: string;
}> = [
  { value: 'protagonists', label: '主角' },
  { value: 'core', label: '核心角色' },
  { value: 'supporting', label: '配角' },
  { value: 'background', label: '背景角色' },
];

export const storyRoleGenderOptions: readonly StoryRoleGender[] = [
  '男',
  '女',
  '未设定',
];
export const storyRoleCampOptions: readonly StoryRoleCamp[] = [
  '主角方',
  '对立方',
  '中立',
  '未明确',
];
export const storyRoleAppearanceFrequencyOptions: readonly StoryRoleAppearanceFrequency[] =
  ['高频', '中频', '低频', '仅被提及'];

export type StoryRoleGroup = {
  id: StoryRoleCategory;
  label: string;
  roles: StoryRoleAsset[];
};

export function groupStoryRoleAssets(
  roles: readonly StoryRoleAsset[],
): StoryRoleGroup[] {
  return storyRoleCategoryOptions.map((category) => ({
    id: category.value,
    label: category.label,
    roles: roles
      .filter((role) => role.category === category.value)
      .map(cloneRole),
  }));
}

export function storyRoleCategoryLabel(category: StoryRoleCategory): string {
  return (
    storyRoleCategoryOptions.find((option) => option.value === category)
      ?.label ?? '角色'
  );
}

function cloneRole(role: StoryRoleAsset): StoryRoleAsset {
  return {
    ...role,
    speechProfile: {
      ...role.speechProfile,
      habits: [...role.speechProfile.habits],
      dialogueExamples: role.speechProfile.dialogueExamples.map((example) => ({
        ...example,
      })),
    },
  };
}

export type { StoryRoleAsset } from '../../../../api/story-api';
