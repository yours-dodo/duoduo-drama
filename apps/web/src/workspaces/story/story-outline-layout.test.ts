import { describe, expect, it } from 'vitest';

import {
  buildOutlineLayout,
  createOutlineSeed,
  getDefaultView,
  getViewsForMode,
  insertOutlineNode,
  removeOutlineNode,
} from './story-outline-layout';

describe('story outline layouts', () => {
  it('keeps one document compatible with all five views', () => {
    const document = createOutlineSeed();
    const views = [
      ...getViewsForMode('timeline'),
      ...getViewsForMode('organization'),
    ];

    expect(views).toHaveLength(5);
    views.forEach((view) => {
      const layout = buildOutlineLayout(
        document.nodes,
        document.edges,
        view,
      );
      expect(layout.nodes).toHaveLength(document.nodes.length);
      expect(layout.nodes.every((node) => node.x >= 0 && node.y >= 0)).toBe(
        true,
      );
    });
  });

  it('uses organization mindmap as the default view', () => {
    expect(getDefaultView('organization')).toBe('organization-mindmap');
    expect(getDefaultView('timeline')).toBe('timeline-horizontal');
  });

  it('inserts a node after the selected node and creates a relation', () => {
    const document = createOutlineSeed();
    const next = insertOutlineNode(
      document.nodes,
      document.edges,
      {
        title: '新的转折',
        summary: '一个新的故事节点。',
        type: 'event',
        lane: '主线',
      },
      'outline-letter',
    );

    const node = next.nodes.find((item) => item.title === '新的转折');
    expect(node?.parentId).toBe('outline-letter');
    expect(node?.order).toBe(1.5);
    expect(
      next.edges.some(
        (edge) =>
          edge.source === 'outline-letter' && edge.target === node?.id,
      ),
    ).toBe(true);
  });

  it('removes a node and all connected edges without leaving children orphaned', () => {
    const document = createOutlineSeed();
    const next = removeOutlineNode(
      document.nodes,
      document.edges,
      'outline-archive',
    );

    expect(next.nodes.some((node) => node.id === 'outline-archive')).toBe(false);
    expect(
      next.edges.some(
        (edge) =>
          edge.source === 'outline-archive' || edge.target === 'outline-archive',
      ),
    ).toBe(false);
    expect(
      next.nodes.find((node) => node.id === 'outline-truth')?.parentId,
    ).toBeUndefined();
  });
});
