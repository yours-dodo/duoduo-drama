import { describe, expect, it } from 'vitest';

import {
  storyEraFromWorldview,
  storyRolePlaceholderUrl,
} from './story-role-placeholder';
import { createWorldviewKnowledgeGraphSeed } from './story-worldview-ontology';

describe('story role placeholders', () => {
  it('reads the first configured location era and defaults to modern', () => {
    const graph = createWorldviewKnowledgeGraphSeed();
    expect(storyEraFromWorldview(graph)).toBe('近未来');

    const emptyGraph = { nodes: [], statements: [] };
    expect(storyEraFromWorldview(emptyGraph)).toBe('现代');
  });

  it('selects placeholder by era and gender', () => {
    expect(storyRolePlaceholderUrl('女', '古代')).toBe('/古代女角色占位.png');
    expect(storyRolePlaceholderUrl('男', '近未来')).toBe('/现代男角色占位.png');
    expect(storyRolePlaceholderUrl('未设定', '未设定')).toBe(
      '/现代男角色占位.png',
    );
  });
});
