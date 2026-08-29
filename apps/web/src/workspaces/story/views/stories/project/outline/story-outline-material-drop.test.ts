import { describe, expect, it } from 'vitest';

import { findNarrativeMaterialDropTarget } from './story-outline-material-drop';
import type { PositionedOutlineNode } from './story-outline-types';

const nodes: PositionedOutlineNode[] = [
  {
    id: 'story',
    title: '故事',
    summary: '',
    type: 'chapter',
    order: 0,
    x: 0,
    y: 0,
  },
  {
    id: 'chapter-first',
    title: '第一章',
    summary: '',
    type: 'chapter',
    parentId: 'story',
    order: 1,
    x: 320,
    y: 0,
  },
  {
    id: 'chapter-second',
    title: '第二章',
    summary: '',
    type: 'chapter',
    parentId: 'story',
    order: 2,
    x: 320,
    y: 180,
  },
  {
    id: 'material',
    title: '已有事件',
    summary: '',
    type: 'event',
    parentId: 'chapter-first',
    order: 3,
    x: 640,
    y: 0,
  },
];

const structuralNodeIds = new Set(['story', 'chapter-first', 'chapter-second']);

describe('outline material drop target', () => {
  it('returns the structural node under the pointer instead of the first node', () => {
    expect(
      findNarrativeMaterialDropTarget(nodes, structuralNodeIds, {
        x: 430,
        y: 236,
      })?.id,
    ).toBe('chapter-second');
  });

  it('rejects a drop on blank canvas space', () => {
    expect(
      findNarrativeMaterialDropTarget(nodes, structuralNodeIds, {
        x: 900,
        y: 500,
      }),
    ).toBeNull();
  });

  it('rejects a drop on an existing material node', () => {
    expect(
      findNarrativeMaterialDropTarget(nodes, structuralNodeIds, {
        x: 750,
        y: 56,
      }),
    ).toBeNull();
  });

  it('prefers the deeper structural node when eligible bounds overlap', () => {
    const overlappingNodes: PositionedOutlineNode[] = [
      nodes[0]!,
      { ...nodes[1]!, x: 0, y: 0 },
    ];

    expect(
      findNarrativeMaterialDropTarget(overlappingNodes, structuralNodeIds, {
        x: 110,
        y: 56,
      })?.id,
    ).toBe('chapter-first');
  });
});
