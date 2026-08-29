import { describe, expect, it } from 'vitest';

import {
  buildOutlineLayout,
  clampOutlinePosition,
  createOutlineSeed,
  getDefaultView,
  getViewsForMode,
  insertOutlineNode,
  removeOutlineNode,
} from './story-outline-layout';
import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineEdgePort,
  type OutlineEdgeRoute,
  type OutlineNode,
  type OutlineRoutePoint,
  type PositionedOutlineNode,
} from './story-outline-types';

function getRoutePaths(route: OutlineEdgeRoute) {
  return (
    (route as OutlineEdgeRoute & { subpaths?: readonly OutlineRoutePoint[][] })
      .subpaths ?? [route.points]
  );
}

function isOrthogonalPath(points: readonly OutlineRoutePoint[]) {
  return points.slice(1).every((point, index) => {
    const previous = points[index];
    return previous.x === point.x || previous.y === point.y;
  });
}

function getPortPoint(
  node: PositionedOutlineNode,
  port: OutlineEdgePort,
): OutlineRoutePoint {
  if (port.side === 'north') {
    return { x: node.x + OUTLINE_NODE_WIDTH * port.offset, y: node.y };
  }
  if (port.side === 'south') {
    return {
      x: node.x + OUTLINE_NODE_WIDTH * port.offset,
      y: node.y + OUTLINE_NODE_HEIGHT,
    };
  }
  if (port.side === 'west') {
    return { x: node.x, y: node.y + OUTLINE_NODE_HEIGHT * port.offset };
  }
  return {
    x: node.x + OUTLINE_NODE_WIDTH,
    y: node.y + OUTLINE_NODE_HEIGHT * port.offset,
  };
}

function segmentCrossesNodeInterior(
  start: OutlineRoutePoint,
  end: OutlineRoutePoint,
  node: PositionedOutlineNode,
) {
  if (start.y === end.y) {
    return (
      start.y > node.y &&
      start.y < node.y + OUTLINE_NODE_HEIGHT &&
      Math.max(Math.min(start.x, end.x), node.x) <
        Math.min(Math.max(start.x, end.x), node.x + OUTLINE_NODE_WIDTH)
    );
  }
  if (start.x === end.x) {
    return (
      start.x > node.x &&
      start.x < node.x + OUTLINE_NODE_WIDTH &&
      Math.max(Math.min(start.y, end.y), node.y) <
        Math.min(Math.max(start.y, end.y), node.y + OUTLINE_NODE_HEIGHT)
    );
  }
  return true;
}

describe('story outline layouts', () => {
  it('keeps one document compatible with all five views', () => {
    const document = createOutlineSeed();
    const views = [
      ...getViewsForMode('timeline'),
      ...getViewsForMode('organization'),
    ];

    expect(views).toHaveLength(5);
    views.forEach((view) => {
      const layout = buildOutlineLayout(document.nodes, document.edges, view);
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

  it('keeps related nodes aligned on the same timeline rail', () => {
    const document = createOutlineSeed();
    const horizontal = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
    );
    const vertical = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-vertical',
    );
    const horizontalNodes = new Map(
      horizontal.nodes.map((node) => [node.id, node]),
    );
    const verticalNodes = new Map(
      vertical.nodes.map((node) => [node.id, node]),
    );

    expect(horizontalNodes.get('outline-letter')?.y).toBe(
      horizontalNodes.get('outline-archive')?.y,
    );
    expect(horizontalNodes.get('outline-archive')?.y).toBe(
      horizontalNodes.get('outline-truth')?.y,
    );
    expect(horizontalNodes.get('outline-truth')?.y).toBe(
      horizontalNodes.get('outline-choice')?.y,
    );
    expect(verticalNodes.get('outline-letter')?.x).toBe(
      verticalNodes.get('outline-archive')?.x,
    );
    expect(verticalNodes.get('outline-archive')?.x).toBe(
      verticalNodes.get('outline-truth')?.x,
    );
  });

  it('builds the horizontal timeline around a central axis with upper and lower branches', () => {
    const document = createOutlineSeed();
    const layout = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
    );
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));
    const mainline = [
      'outline-core',
      'outline-letter',
      'outline-archive',
      'outline-truth',
      'outline-choice',
      'outline-ending',
    ];

    expect(new Set(mainline.map((id) => positions.get(id)?.y)).size).toBe(1);
    expect(
      new Set(
        mainline.slice(1).map((id, index) => {
          const current = positions.get(id)?.x ?? 0;
          const previous = positions.get(mainline[index])?.x ?? 0;
          return current - previous;
        }),
      ).size,
    ).toBe(1);
    expect(positions.get('outline-lin')?.y).toBeGreaterThan(
      positions.get('outline-letter')?.y ?? -Infinity,
    );
    expect(positions.get('outline-zhou')?.y).toBeLessThan(
      positions.get('outline-truth')?.y ?? Infinity,
    );
    expect(
      layout.edgeRoutes?.some(
        (route) =>
          route.edgeId === 'timeline-branch-outline-letter-outline-lin' &&
          route.decorativeRole === 'branch',
      ),
    ).toBe(true);
    expect(
      layout.edgeRoutes?.some(
        (route) =>
          route.edgeId === 'timeline-branch-outline-truth-outline-zhou' &&
          route.decorativeRole === 'branch',
      ),
    ).toBe(true);
    expect(layout.edgeRoutes?.some((route) => route.decorative)).toBe(true);
    expect(
      layout.edgeRoutes?.every((route) =>
        getRoutePaths(route).every(isOrthogonalPath),
      ),
    ).toBe(true);
  });

  it('keeps branch-only sequence spurs off the central axis', () => {
    const nodes: OutlineNode[] = [
      {
        id: 'root',
        title: '主线起点',
        summary: '',
        type: 'chapter',
        lane: '主线',
        order: 0,
      },
      {
        id: 'next',
        title: '主线终点',
        summary: '',
        type: 'event',
        lane: '主线',
        order: 3,
      },
      {
        id: 'branch-a',
        title: '分支 A',
        summary: '',
        type: 'character',
        parentId: 'root',
        lane: '人物',
        order: 1,
      },
      {
        id: 'branch-b',
        title: '分支 B',
        summary: '',
        type: 'character',
        parentId: 'root',
        lane: '人物',
        order: 2,
      },
      {
        id: 'branch-a-child',
        title: '分支 A 的后续',
        summary: '',
        type: 'event',
        parentId: 'branch-a',
        lane: '人物',
        order: 4,
      },
      {
        id: 'branch-a-child-2',
        title: '分支 A 的另一条后续',
        summary: '',
        type: 'event',
        parentId: 'branch-a',
        lane: '人物',
        order: 5,
      },
    ];
    const edges: OutlineEdge[] = [
      { id: 'root-next', source: 'root', target: 'next', kind: 'sequence' },
      {
        id: 'root-branch-a',
        source: 'root',
        target: 'branch-a',
        kind: 'sequence',
      },
      {
        id: 'root-branch-b',
        source: 'root',
        target: 'branch-b',
        kind: 'sequence',
      },
      {
        id: 'branch-a-child',
        source: 'branch-a',
        target: 'branch-a-child',
        kind: 'sequence',
      },
      {
        id: 'branch-a-child-2',
        source: 'branch-a',
        target: 'branch-a-child-2',
        kind: 'sequence',
      },
    ];
    const layout = buildOutlineLayout(nodes, edges, 'timeline-horizontal');
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));
    const root = positions.get('root');
    const next = positions.get('next');
    const branchA = positions.get('branch-a');
    const branchB = positions.get('branch-b');
    const branchChild = positions.get('branch-a-child');
    const branchChild2 = positions.get('branch-a-child-2');

    expect(root?.y).toBe(next?.y);
    expect(branchA?.y).not.toBe(root?.y);
    expect(branchA?.x).toBe(branchB?.x);
    expect(branchChild?.x).toBeGreaterThan(branchA?.x ?? -Infinity);
    expect(branchChild?.x).toBe(branchChild2?.x);
    expect(branchChild?.y).not.toBe(branchChild2?.y);

    const branchRoutes = layout.edgeRoutes?.filter(
      (route) => route.decorativeRole === 'branch',
    );
    expect(branchRoutes).toHaveLength(2);
    expect(branchRoutes?.every((route) => route.cornerRadius === 24)).toBe(
      true,
    );
    const childGroupRoute = branchRoutes?.find(
      (route) => route.source === 'branch-a',
    );
    expect(childGroupRoute).toBeDefined();
    const childGroupPaths = childGroupRoute
      ? getRoutePaths(childGroupRoute)
      : [];
    expect(childGroupPaths).toHaveLength(3);
    expect(
      childGroupPaths.slice(1).every((path) => {
        const start = path[0];
        const turn = path[1];
        return (
          start &&
          turn &&
          start.x === turn.x &&
          Math.abs(turn.y - start.y) >= 48
        );
      }),
    ).toBe(true);
    expect(childGroupPaths.every(isOrthogonalPath)).toBe(true);
    expect(
      layout.edgeRoutes?.filter(
        (route) =>
          route.source === 'branch-a' &&
          route.hidden &&
          route.target.startsWith('branch-a-child'),
      ),
    ).toHaveLength(2);

    const nodesById = new Map(layout.nodes.map((node) => [node.id, node]));
    branchRoutes?.forEach((route) => {
      const sourcePort = layout.edgePorts?.[route.sourcePortId];
      const targetPort = layout.edgePorts?.[route.targetPortId];
      const sourceNode = nodesById.get(route.source);
      const targetNode = nodesById.get(route.target);
      expect(sourcePort).toBeDefined();
      expect(targetPort).toBeDefined();
      expect(sourceNode).toBeDefined();
      expect(targetNode).toBeDefined();
      expect(route.points[0]?.x).toBe(route.points[1]?.x);
      expect(route.points[0]?.y).not.toBe(route.points[1]?.y);
      expect(route.points[0]).toEqual(getPortPoint(sourceNode!, sourcePort!));
      expect(route.points.at(-1)).toEqual(
        getPortPoint(targetNode!, targetPort!),
      );
    });
  });

  it('keeps semantic relations and manually displaced axis routes orthogonal', () => {
    const nodes: OutlineNode[] = [
      {
        id: 'root',
        title: '主线起点',
        summary: '',
        type: 'chapter',
        lane: '主线',
        order: 0,
      },
      {
        id: 'next',
        title: '主线终点',
        summary: '',
        type: 'event',
        lane: '主线',
        order: 3,
      },
      {
        id: 'branch-a',
        title: '分支 A',
        summary: '',
        type: 'character',
        parentId: 'root',
        order: 1,
      },
      {
        id: 'branch-b',
        title: '分支 B',
        summary: '',
        type: 'character',
        parentId: 'root',
        order: 2,
      },
    ];
    const edges: OutlineEdge[] = [
      { id: 'root-next', source: 'root', target: 'next', kind: 'sequence' },
      {
        id: 'branch-relation',
        source: 'branch-a',
        target: 'branch-b',
        kind: 'relation',
      },
    ];
    const layout = buildOutlineLayout(nodes, edges, 'timeline-horizontal', {
      root: { x: 80, y: 120 },
    });
    const relationRoute = layout.edgeRoutes?.find(
      (route) => route.edgeId === 'branch-relation',
    );
    const axisRoute = layout.edgeRoutes?.find(
      (route) => route.decorativeRole === 'axis',
    );

    expect(relationRoute).toBeDefined();
    expect(axisRoute).toBeDefined();
    expect(getRoutePaths(relationRoute!).every(isOrthogonalPath)).toBe(true);
    expect(getRoutePaths(axisRoute!).every(isOrthogonalPath)).toBe(true);
  });

  it('routes a skipped semantic edge around intervening mainline cards', () => {
    const nodes: OutlineNode[] = ['a', 'b', 'c'].map((id, order) => ({
      id,
      title: id,
      summary: '',
      type: 'event',
      lane: '主线',
      order,
    }));
    const edges: OutlineEdge[] = [
      { id: 'a-b', source: 'a', target: 'b', kind: 'sequence' },
      { id: 'b-c', source: 'b', target: 'c', kind: 'sequence' },
      { id: 'a-c', source: 'a', target: 'c', kind: 'sequence' },
    ];
    const layout = buildOutlineLayout(nodes, edges, 'timeline-horizontal');
    const middleNode = layout.nodes.find((node) => node.id === 'b');
    const skippedRoute = layout.edgeRoutes?.find(
      (route) => route.edgeId === 'a-c',
    );

    expect(middleNode).toBeDefined();
    expect(skippedRoute).toBeDefined();
    expect(skippedRoute?.points.length).toBeGreaterThan(2);
    expect(isOrthogonalPath(skippedRoute!.points)).toBe(true);
    expect(
      skippedRoute?.points
        .slice(1)
        .some((point, index) =>
          segmentCrossesNodeInterior(
            skippedRoute.points[index],
            point,
            middleNode!,
          ),
        ),
    ).toBe(false);
  });

  it('reserves horizontal space for a branch subtree before placing the next primary node', () => {
    const document = createOutlineSeed();
    const layout = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
    );
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));
    const letter = positions.get('outline-letter');
    const archive = positions.get('outline-archive');
    const lin = positions.get('outline-lin');

    expect(archive?.x).toBeGreaterThan((lin?.x ?? 0) + OUTLINE_NODE_WIDTH + 96);
    expect(layout.width).toBeGreaterThan(
      Math.max(...layout.nodes.map((node) => node.x + OUTLINE_NODE_WIDTH)),
    );
    expect(letter?.y).toBe(archive?.y);
  });

  it('anchors fishbone branches near the mainline instead of stacking them in a separate column', () => {
    const document = createOutlineSeed();
    const layout = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-fishbone',
    );
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(positions.get('outline-lin')?.x).toBeGreaterThan(500);
    expect(positions.get('outline-lin')?.y).toBeLessThan(200);
    expect(positions.get('outline-truth')?.y).toBeGreaterThan(400);
    expect(positions.get('outline-zhou')?.y).toBeLessThan(200);
  });

  it('keeps organization layers centered and gives the mindmap deeper rings', () => {
    const document = createOutlineSeed();
    const logic = buildOutlineLayout(
      document.nodes,
      document.edges,
      'organization-logic',
    );
    const mindmap = buildOutlineLayout(
      document.nodes,
      document.edges,
      'organization-mindmap',
    );
    const logicPositions = new Map(logic.nodes.map((node) => [node.id, node]));
    const mindmapPositions = new Map(
      mindmap.nodes.map((node) => [node.id, node]),
    );

    expect(logicPositions.get('outline-core')?.x).toBeLessThan(
      logicPositions.get('outline-archive')?.x ?? Infinity,
    );
    expect(logicPositions.get('outline-letter')?.y).toBe(
      logicPositions.get('outline-archive')?.y,
    );
    expect(logicPositions.get('outline-archive')?.y).toBe(
      logicPositions.get('outline-truth')?.y,
    );
    expect(logicPositions.get('outline-lin')?.y).toBeLessThan(
      logicPositions.get('outline-archive')?.y ?? Infinity,
    );
    expect(logicPositions.get('outline-zhou')?.y).toBeGreaterThan(
      logicPositions.get('outline-truth')?.y ?? -Infinity,
    );
    expect(
      Math.abs(
        (mindmapPositions.get('outline-lin')?.x ?? 0) -
          (mindmapPositions.get('outline-core')?.x ?? 0),
      ),
    ).toBeGreaterThan(200);
    expect(mindmap.width).toBeGreaterThan(logic.width);
  });

  it('does not leave cards overlapping after the automatic layout pass', () => {
    const document = createOutlineSeed();
    const views = [
      ...getViewsForMode('timeline'),
      ...getViewsForMode('organization'),
    ];

    views.forEach((view) => {
      const layout = buildOutlineLayout(document.nodes, document.edges, view);
      layout.nodes.forEach((node, index) => {
        layout.nodes.slice(index + 1).forEach((other) => {
          const overlaps =
            node.x < other.x + OUTLINE_NODE_WIDTH &&
            node.x + OUTLINE_NODE_WIDTH > other.x &&
            node.y < other.y + OUTLINE_NODE_HEIGHT &&
            node.y + OUTLINE_NODE_HEIGHT > other.y;
          expect(overlaps, `${view}: ${node.id} overlaps ${other.id}`).toBe(
            false,
          );
        });
      });
    });
  });

  it('deterministically nudges colliding manual positions along the sibling axis', () => {
    const document = createOutlineSeed();
    const overrides = {
      'outline-lin': { x: 80, y: 420 },
      'outline-zhou': { x: 80, y: 420 },
    };
    const first = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
      overrides,
    );
    const second = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
      overrides,
    );
    const firstPositions = new Map(
      first.nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
    );
    const lin = firstPositions.get('outline-lin');
    const zhou = firstPositions.get('outline-zhou');

    expect(lin?.x).toBe(80);
    expect(zhou?.x).toBe(80);
    expect(lin?.y).not.toBe(420);
    expect(zhou?.y).not.toBe(lin?.y);
    expect(Math.abs((zhou?.y ?? 0) - (lin?.y ?? 0))).toBeGreaterThanOrEqual(
      OUTLINE_NODE_HEIGHT + 32,
    );
    expect(
      second.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    ).toEqual(
      first.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y })),
    );
  });

  it('preserves an unobstructed manual drop position exactly', () => {
    const document = createOutlineSeed();
    const layout = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
      { 'outline-lin': { x: 80, y: -240 } },
    );

    expect(layout.nodes.find((node) => node.id === 'outline-lin')).toEqual(
      expect.objectContaining({ x: 80, y: -240 }),
    );
  });

  it('packs dense manual siblings into one aligned collision-free column', () => {
    const root: OutlineNode = {
      id: 'dense-root',
      title: '主干',
      summary: '',
      type: 'chapter',
      lane: '主线',
      order: 0,
    };
    const materials: OutlineNode[] = Array.from({ length: 12 }, (_, index) => ({
      id: `dense-material-${index}`,
      title: `物料 ${index + 1}`,
      summary: '',
      type: 'foreshadow',
      parentId: root.id,
      lane: '剧情资产',
      order: index + 1,
    }));
    const edges: OutlineEdge[] = materials.map((node) => ({
      id: `dense-edge-${node.id}`,
      source: root.id,
      target: node.id,
      kind: 'relation',
    }));
    const overrides = Object.fromEntries(
      materials.map((node) => [node.id, { x: 360, y: 420 }]),
    );
    const layout = buildOutlineLayout(
      [root, ...materials],
      edges,
      'timeline-horizontal',
      overrides,
    );
    const positionedMaterials = layout.nodes
      .filter((node) => node.id.startsWith('dense-material-'))
      .sort((left, right) => left.y - right.y);

    expect(new Set(positionedMaterials.map((node) => node.x))).toEqual(
      new Set([360]),
    );
    expect(new Set(positionedMaterials.map((node) => node.y)).size).toBe(12);
    positionedMaterials.slice(1).forEach((node, index) => {
      expect(node.y - positionedMaterials[index].y).toBeGreaterThanOrEqual(
        OUTLINE_NODE_HEIGHT + 32,
      );
    });
  });

  it('preserves a node position above the horizontal timeline axis', () => {
    const document = createOutlineSeed();
    const position = clampOutlinePosition({ x: 420, y: -48 });
    const layout = buildOutlineLayout(
      document.nodes,
      document.edges,
      'timeline-horizontal',
      { 'outline-letter': position },
    );

    expect(position.y).toBe(-48);
    expect(layout.nodes.find((node) => node.id === 'outline-letter')?.y).toBe(
      -48,
    );
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
        (edge) => edge.source === 'outline-letter' && edge.target === node?.id,
      ),
    ).toBe(true);
    expect(
      next.edges.find(
        (edge) => edge.source === 'outline-letter' && edge.target === node?.id,
      )?.kind,
    ).toBe('sequence');
  });

  it('removes a node and all connected edges without leaving children orphaned', () => {
    const document = createOutlineSeed();
    const next = removeOutlineNode(
      document.nodes,
      document.edges,
      'outline-archive',
    );

    expect(next.nodes.some((node) => node.id === 'outline-archive')).toBe(
      false,
    );
    expect(
      next.edges.some(
        (edge) =>
          edge.source === 'outline-archive' ||
          edge.target === 'outline-archive',
      ),
    ).toBe(false);
    expect(
      next.nodes.find((node) => node.id === 'outline-truth')?.parentId,
    ).toBeUndefined();
  });
});
