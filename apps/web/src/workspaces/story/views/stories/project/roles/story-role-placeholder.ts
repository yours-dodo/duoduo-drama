import {
  getWorldviewEntities,
  type WorldviewKnowledgeGraphState,
} from '../worldview/story-worldview-ontology';

import type { StoryRoleGender } from '../../../../api/story-api';

type StoryRolePlaceholderEra = 'modern' | 'ancient';

const placeholderImages: Record<
  StoryRolePlaceholderEra,
  Record<'male' | 'female', string>
> = {
  modern: {
    male: '/现代男角色占位.png',
    female: '/现代女角色占位.png',
  },
  ancient: {
    male: '/古代男角色占位.png',
    female: '/古代女角色占位.png',
  },
};

export function storyEraFromWorldview(
  graph: WorldviewKnowledgeGraphState,
): string {
  const location = getWorldviewEntities(graph).find(
    (entity) =>
      entity.type === '地点' && entity.attributes.era.trim().length > 0,
  );
  return location?.type === '地点' ? location.attributes.era.trim() : '现代';
}

export function storyRolePlaceholderUrl(
  gender: StoryRoleGender | null | undefined,
  era: string | null | undefined,
): string {
  const eraKey = classifyEra(era);
  const genderKey = gender === '女' ? 'female' : 'male';
  return placeholderImages[eraKey][genderKey];
}

function classifyEra(era: string | null | undefined): StoryRolePlaceholderEra {
  const normalized = era?.trim() ?? '';
  return /古代|古风|架空古/.test(normalized) ? 'ancient' : 'modern';
}
