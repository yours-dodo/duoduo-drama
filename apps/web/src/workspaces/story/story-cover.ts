import type { StoryProject } from './story-api';

export const storyCoverVariants = [
  'cover-a',
  'cover-b',
  'cover-c',
  'cover-d',
] as const;

export type StoryCoverVariant = (typeof storyCoverVariants)[number];

export function hasStoryCover(
  project: Pick<StoryProject, 'coverUrl'>,
): project is Pick<StoryProject, 'coverUrl'> & { coverUrl: string } {
  return typeof project.coverUrl === 'string' && project.coverUrl.trim() !== '';
}

export function getStoryCoverVariant(projectId: string): StoryCoverVariant {
  let hash = 0;
  for (const character of projectId) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return storyCoverVariants[hash % storyCoverVariants.length];
}
