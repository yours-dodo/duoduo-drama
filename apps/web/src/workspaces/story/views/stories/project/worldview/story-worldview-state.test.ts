import { describe, expect, it } from 'vitest';

import { createStoryWorldviewStateRegistry } from './story-worldview-state';

describe('story worldview state registry', () => {
  it('keeps each project knowledge graph isolated', () => {
    const registry = createStoryWorldviewStateRegistry();

    const firstGraph = registry.getGraph('project-1');
    const secondGraph = registry.getGraph('project-2');
    firstGraph.nodes.splice(0, 1);

    expect(registry.getGraph('project-1')).toBe(firstGraph);
    expect(secondGraph.nodes).toHaveLength(firstGraph.nodes.length + 1);
  });

  it('creates unique drafts and saves them for the composition route', () => {
    const registry = createStoryWorldviewStateRegistry();

    const first = registry.createEntity('project-1', '地点', 'locations');
    const second = registry.createEntity('project-1', '地点', 'locations');
    const saved = { ...first, name: '新港区' };

    expect(first.id).not.toBe(second.id);
    expect(registry.saveEntity('project-1', saved)).toBe(true);
    expect(registry.getEntity('project-1', first.id)?.name).toBe('新港区');
  });

  it('blocks referenced entities and deletes unreferenced drafts', () => {
    const registry = createStoryWorldviewStateRegistry();
    const draft = registry.createEntity('project-1', '规则', 'rules');

    expect(registry.deleteEntity('project-1', 'fog-city')).toMatchObject({
      deleted: false,
    });
    expect(registry.deleteEntity('project-1', draft.id)).toEqual({
      deleted: true,
      references: [],
    });
    expect(registry.getEntity('project-1', draft.id)).toBeUndefined();
  });
});
