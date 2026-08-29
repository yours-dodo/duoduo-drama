import { describe, expect, it } from 'vitest';

import {
  deriveOrganizationEdges,
  getOrganizationLayoutOptions,
  validateOutlineRoutes,
} from './story-outline-elk-layout';
import type {
  OutlineEdgeRoute,
  OutlineNode,
  PositionedOutlineNode,
} from './story-outline-types';

const nodes: OutlineNode[] = [
  {
    id: 'root',
    title: 'Root',
    summary: '',
    type: 'chapter',
    order: 0,
  },
  {
    id: 'child',
    title: 'Child',
    summary: '',
    type: 'event',
    parentId: 'root',
    order: 1,
  },
];

describe('story outline ELK adapter', () => {
  it('enriches the graph with a derived parent edge without duplicating stored pairs', () => {
    const edges = deriveOrganizationEdges(nodes, [
      {
        id: 'sequence-root-child',
        source: 'root',
        target: 'child',
        kind: 'sequence',
      },
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: 'sequence-root-child',
      sourcePortId: 'source:sequence-root-child',
      targetPortId: 'target:sequence-root-child',
    });
  });

  it('keeps parent relationships visible when no stored edge exists', () => {
    const edges = deriveOrganizationEdges(nodes, []);

    expect(edges).toEqual([
      expect.objectContaining({
        id: 'parent-root-child',
        source: 'root',
        target: 'child',
        derived: true,
      }),
    ]);
  });

  it('uses a rightward layered orthogonal graph for both organization views', () => {
    const logic = getOrganizationLayoutOptions('organization-logic');
    const mindmap = getOrganizationLayoutOptions('organization-mindmap');

    expect(logic).toMatchObject({
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.mergeEdges': 'false',
    });
    expect(Number(mindmap['elk.spacing.nodeNode'])).toBeGreaterThan(
      Number(logic['elk.spacing.nodeNode']),
    );
  });

  it('rejects diagonal routes and segments that pass through another node', () => {
    const positioned: PositionedOutlineNode[] = nodes.map((node, index) => ({
      ...node,
      x: index * 300,
      y: 0,
    }));
    const badRoute: OutlineEdgeRoute = {
      edgeId: 'bad',
      source: 'root',
      target: 'child',
      sourcePortId: 'source:bad',
      targetPortId: 'target:bad',
      points: [
        { x: 220, y: 56 },
        { x: 350, y: 160 },
      ],
    };

    expect(validateOutlineRoutes(positioned, [badRoute])).toEqual(
      expect.arrayContaining(['bad:diagonal-segment', 'bad:target-not-port']),
    );
  });
});
