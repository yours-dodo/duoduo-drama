import ELK, {
  type ElkEdgeSection,
  type ElkNode,
  type ElkPoint,
  type ElkPort,
  type ELK as ElkEngine,
} from 'elkjs/lib/elk.bundled.js';

import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineEdgePort,
  type OutlineEdgeRoute,
  type OutlineLayout,
  type OutlineNode,
  type OutlinePortSide,
  type OutlinePositionMap,
  type OutlineRouteCrossing,
  type OutlineRoutePoint,
  type PositionedOutlineNode,
} from './story-outline-types';

type OrganizationView = 'organization-logic' | 'organization-mindmap';

type LayoutGraphEdge = OutlineEdge & {
  derived?: boolean;
  sourcePortId: string;
  targetPortId: string;
};

type PortAssignment = OutlineEdgePort & {
  order: number;
};

const ROOT_ID = 'outline-elk-root';
const LAYOUT_PADDING = 56;
const EPSILON = 0.5;

// ELK's bundled browser worker does not expose a terminate() method. Reuse one
// engine for the workspace instead of treating a successful layout as a
// failure during cleanup. Lazy construction also keeps server-side module
// evaluation free of browser Worker globals.
let elkInstance: ElkEngine | null = null;

function getElk() {
  elkInstance ??= new ELK({ algorithms: ['layered'] });
  return elkInstance;
}

const SIDE_TO_ELK: Record<OutlinePortSide, string> = {
  north: 'NORTH',
  east: 'EAST',
  south: 'SOUTH',
  west: 'WEST',
};

const DEFAULT_LAYOUT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.mergeEdges': 'false',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.spacing.nodeNode': '72',
  'elk.spacing.edgeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '144',
  'elk.layered.spacing.edgeNodeBetweenLayers': '48',
};

export function getOrganizationLayoutOptions(
  view: OrganizationView,
  interactive = false,
): Record<string, string> {
  return {
    ...DEFAULT_LAYOUT_OPTIONS,
    ...(view === 'organization-mindmap'
      ? {
          'elk.spacing.nodeNode': '96',
          'elk.spacing.edgeNode': '64',
          'elk.layered.spacing.nodeNodeBetweenLayers': '64',
          'elk.layered.spacing.edgeNodeBetweenLayers': '36',
          'elk.layered.layering.strategy': 'INTERACTIVE',
          'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
          'elk.interactiveLayout': 'true',
        }
      : {}),
    ...(interactive ? { 'elk.interactiveLayout': 'true' } : {}),
  };
}

/**
 * The persisted document stores parentId separately from explicit edges. ELK
 * receives a complete visible graph, while derived parent edges stay in
 * memory and are never written back to the story document.
 */
export function deriveOrganizationEdges(
  nodes: readonly OutlineNode[],
  edges: readonly OutlineEdge[],
): LayoutGraphEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const visible: LayoutGraphEdge[] = [];
  const pairs = new Set<string>();

  const add = (edge: OutlineEdge, derived = false) => {
    if (
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      edge.source === edge.target
    ) {
      return;
    }
    const pair = `${edge.source}->${edge.target}`;
    if (pairs.has(pair)) return;
    pairs.add(pair);
    visible.push({ ...edge, derived });
  };

  [...edges]
    .filter((edge) => edge.kind === 'sequence' || edge.kind === 'relation')
    .sort(compareEdges)
    .forEach((edge) => add(edge));

  [...nodes].sort(compareNodes).forEach((node) => {
    if (!node.parentId) return;
    add(
      {
        id: `parent-${node.parentId}-${node.id}`,
        source: node.parentId,
        target: node.id,
        label: '包含',
        kind: 'sequence',
      },
      true,
    );
  });

  return visible.map((edge) => ({
    ...edge,
    sourcePortId: `source:${edge.id}`,
    targetPortId: `target:${edge.id}`,
  }));
}

export async function buildOrganizationElkLayout(
  nodes: readonly OutlineNode[],
  edges: readonly OutlineEdge[],
  view: OrganizationView,
  overrides: OutlinePositionMap = {},
): Promise<OutlineLayout> {
  const graphEdges = deriveOrganizationEdges(nodes, edges);
  const layoutEdges =
    view === 'organization-mindmap'
      ? getMindmapStructuralEdges(nodes, graphEdges)
      : graphEdges;
  const assignments = assignPorts(nodes, graphEdges);
  const portsByNode = groupPortsByNode(assignments);
  const mindmapHints =
    view === 'organization-mindmap' ? getMindmapTreeHints(nodes) : new Map();
  const graph: ElkNode = {
    id: ROOT_ID,
    layoutOptions: getOrganizationLayoutOptions(
      view,
      Object.keys(overrides).length > 0,
    ),
    children: [...nodes].sort(compareNodes).map((node) => {
      const hint = mindmapHints.get(node.id);
      return {
        id: node.id,
        width: OUTLINE_NODE_WIDTH,
        height: OUTLINE_NODE_HEIGHT,
        ...(overrides[node.id]
          ? { x: overrides[node.id].x, y: overrides[node.id].y }
          : hint
            ? { x: hint.x, y: hint.y }
            : {}),
        layoutOptions: {
          'elk.portConstraints': 'FIXED_ORDER',
        },
        ports: (portsByNode.get(node.id) ?? []).map((port) => ({
          id: port.id,
          width: 1,
          height: 1,
          layoutOptions: {
            'elk.port.side': SIDE_TO_ELK[port.side],
            'elk.port.index': String(port.order),
          },
        })),
      };
    }),
    edges: layoutEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.sourcePortId],
      targets: [edge.targetPortId],
      labels: edge.label
        ? [{ id: `label:${edge.id}`, text: edge.label }]
        : undefined,
      layoutOptions: {
        // Sequence and parent edges are the backbone of both organization
        // views. Keeping the priority in the graph makes ELK stable when a
        // relation edge competes for the same corridor.
        'elk.priority': edge.kind === 'sequence' ? '10' : '1',
      },
    })),
  };

  const result = await getElk().layout(graph);
  return convertElkLayout(result, nodes, graphEdges, layoutEdges, assignments);
}

function getMindmapStructuralEdges(
  nodes: readonly OutlineNode[],
  edges: readonly LayoutGraphEdge[],
) {
  const parentPairs = new Set(
    nodes
      .filter((node) => node.parentId)
      .map((node) => `${node.parentId}->${node.id}`),
  );
  return edges.filter((edge) =>
    parentPairs.has(`${edge.source}->${edge.target}`),
  );
}

function getMindmapTreeHints(nodes: readonly OutlineNode[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const root =
    [...nodes]
      .filter((node) => !node.parentId || !nodeIds.has(node.parentId))
      .sort(compareNodes)[0] ?? [...nodes].sort(compareNodes)[0];
  const children = new Map<string, OutlineNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId || !nodeIds.has(node.parentId)) return;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  });
  children.forEach((siblings) => siblings.sort(compareNodes));

  const hints = new Map<string, { x: number; y: number }>();
  let leafIndex = 0;
  const place = (node: OutlineNode, depth: number, path: Set<string>) => {
    if (path.has(node.id)) return;
    const nextPath = new Set(path).add(node.id);
    const descendants = children.get(node.id) ?? [];
    if (!descendants.length) {
      hints.set(node.id, {
        x: depth * 420,
        y: leafIndex++ * 184,
      });
      return;
    }
    descendants.forEach((child) => place(child, depth + 1, nextPath));
    const childYs = descendants
      .map((child) => hints.get(child.id)?.y)
      .filter((value): value is number => typeof value === 'number');
    hints.set(node.id, {
      x: depth * 420,
      y: childYs.length
        ? (Math.min(...childYs) + Math.max(...childYs)) / 2
        : leafIndex++ * 184,
    });
  };
  if (root) place(root, 0, new Set());

  [...nodes]
    .filter((node) => !hints.has(node.id))
    .sort(compareNodes)
    .forEach((node) => {
      hints.set(node.id, { x: 420, y: leafIndex++ * 184 });
    });
  return hints;
}

function buildFallbackOrganizationRoute(
  edge: LayoutGraphEdge,
  nodes: readonly PositionedOutlineNode[],
  ports: Record<string, OutlineEdgePort>,
  index: number,
): OutlineEdgeRoute {
  const sourceNode = nodes.find((node) => node.id === edge.source);
  const targetNode = nodes.find((node) => node.id === edge.target);
  const sourcePort = ports[edge.sourcePortId];
  const targetPort = ports[edge.targetPortId];
  const start = getPortPoint(sourceNode, sourcePort);
  const end = getPortPoint(targetNode, targetPort);
  const sourceEscape = {
    x: (sourceNode?.x ?? 0) - 20,
    y: (sourceNode?.y ?? 0) - 20,
  };
  const targetEscape = {
    x: (targetNode?.x ?? 0) - 20,
    y: (targetNode?.y ?? 0) - 20,
  };
  const corridorY = Math.max(
    8,
    Math.min(...nodes.map((node) => node.y), 56) - 32 - index * 4,
  );
  const points = dedupeRoutePoints([
    start,
    { x: start.x, y: sourceEscape.y },
    sourceEscape,
    { x: sourceEscape.x, y: corridorY },
    { x: targetEscape.x, y: corridorY },
    targetEscape,
    { x: end.x, y: targetEscape.y },
    end,
  ]);
  return {
    edgeId: edge.id,
    source: edge.source,
    target: edge.target,
    sourcePortId: edge.sourcePortId,
    targetPortId: edge.targetPortId,
    label: edge.label,
    kind: edge.kind,
    points,
    labelPosition: getPolylineMidpoint(points),
  };
}

function getPortPoint(
  node: PositionedOutlineNode | undefined,
  port: OutlineEdgePort | undefined,
): OutlineRoutePoint {
  if (!node || !port) return { x: 0, y: 0 };
  if (port.side === 'north' || port.side === 'south') {
    return {
      x: node.x + OUTLINE_NODE_WIDTH * port.offset,
      y: port.side === 'north' ? node.y : node.y + OUTLINE_NODE_HEIGHT,
    };
  }
  return {
    x: port.side === 'west' ? node.x : node.x + OUTLINE_NODE_WIDTH,
    y: node.y + OUTLINE_NODE_HEIGHT * port.offset,
  };
}

function dedupeRoutePoints(points: readonly OutlineRoutePoint[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });
}

function assignPorts(
  nodes: readonly OutlineNode[],
  edges: readonly LayoutGraphEdge[],
): PortAssignment[] {
  const assignments: PortAssignment[] = [];
  const byNodeSide = new Map<string, PortAssignment[]>();

  const add = (
    edge: LayoutGraphEdge,
    nodeId: string,
    kind: 'source' | 'target',
    side: OutlinePortSide,
    portId: string,
  ) => {
    const key = `${nodeId}:${side}`;
    const list = byNodeSide.get(key) ?? [];
    const assignment: PortAssignment = {
      id: portId,
      edgeId: edge.id,
      nodeId,
      kind,
      side,
      offset: 0,
      order: list.length,
    };
    list.push(assignment);
    byNodeSide.set(key, list);
    assignments.push(assignment);
  };

  edges.forEach((edge) => {
    const relation = edge.kind === 'relation';
    add(
      edge,
      edge.source,
      'source',
      relation ? 'south' : 'east',
      edge.sourcePortId,
    );
    add(
      edge,
      edge.target,
      'target',
      relation ? 'north' : 'west',
      edge.targetPortId,
    );
  });

  byNodeSide.forEach((list) => {
    list.forEach((port, index) => {
      port.offset = (index + 1) / (list.length + 1);
    });
  });

  return assignments;
}

function groupPortsByNode(assignments: readonly PortAssignment[]) {
  const portsByNode = new Map<string, PortAssignment[]>();
  assignments.forEach((port) => {
    const list = portsByNode.get(port.nodeId) ?? [];
    list.push(port);
    portsByNode.set(port.nodeId, list);
  });
  return portsByNode;
}

function convertElkLayout(
  result: ElkNode,
  sourceNodes: readonly OutlineNode[],
  graphEdges: readonly LayoutGraphEdge[],
  layoutEdges: readonly LayoutGraphEdge[],
  assignments: readonly PortAssignment[],
): OutlineLayout {
  const resultNodes = result.children ?? [];
  const nodeById = new Map(resultNodes.map((node) => [node.id, node]));
  const minX = Math.min(
    ...resultNodes.map((node) => (finite(node.x) ? (node.x ?? 0) : 0)),
    0,
  );
  const minY = Math.min(
    ...resultNodes.map((node) => (finite(node.y) ? (node.y ?? 0) : 0)),
    0,
  );
  const offsetX = LAYOUT_PADDING - minX;
  const offsetY = LAYOUT_PADDING - minY;
  const nodes = sourceNodes.map((node) => {
    const output = nodeById.get(node.id);
    return {
      ...node,
      x: (output?.x ?? 0) + offsetX,
      y: (output?.y ?? 0) + offsetY,
    };
  });
  const edgePorts = Object.fromEntries(
    assignments.map((assignment) => {
      const outputNode = nodeById.get(assignment.nodeId);
      const outputPort = outputNode?.ports?.find(
        (port) => port.id === assignment.id,
      );
      return [
        assignment.id,
        {
          ...assignment,
          offset: getResolvedPortOffset(assignment, outputNode, outputPort),
        },
      ];
    }),
  );
  const layoutEdgeIds = new Set(layoutEdges.map((edge) => edge.id));
  const edgeRoutes = graphEdges.map((edge, index) => {
    const output = result.edges?.find((candidate) => candidate.id === edge.id);
    return output && layoutEdgeIds.has(edge.id)
      ? convertEdgeRoute(edge, output, offsetX, offsetY)
      : buildFallbackOrganizationRoute(edge, nodes, edgePorts, index);
  });
  const validation = validateOutlineRoutes(nodes, edgeRoutes);
  if (validation.length) {
    throw new Error(`ELK route validation failed: ${validation.join('; ')}`);
  }

  const crossings = findRouteCrossings(edgeRoutes);
  crossings.forEach(({ route, crossing }) => {
    route.crossings = [...(route.crossings ?? []), crossing];
  });

  const maxX = Math.max(
    ...nodes.map((node) => node.x + OUTLINE_NODE_WIDTH),
    ...edgeRoutes.flatMap((route) => route.points.map((point) => point.x)),
    LAYOUT_PADDING,
  );
  const maxY = Math.max(
    ...nodes.map((node) => node.y + OUTLINE_NODE_HEIGHT),
    ...edgeRoutes.flatMap((route) => route.points.map((point) => point.y)),
    LAYOUT_PADDING,
  );

  return {
    width: Math.max(maxX + LAYOUT_PADDING, result.width ?? 0),
    height: Math.max(maxY + LAYOUT_PADDING, result.height ?? 0),
    nodes,
    edgeRoutes,
    edgePorts,
  };
}

function convertEdgeRoute(
  edge: LayoutGraphEdge,
  output:
    | {
        sections?: ElkEdgeSection[];
        labels?: { x?: number; y?: number; width?: number; height?: number }[];
      }
    | undefined,
  offsetX: number,
  offsetY: number,
): OutlineEdgeRoute {
  const points = flattenSections(output?.sections ?? []).map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY,
  }));
  const label = output?.labels?.[0];
  const labelPosition =
    label && finite(label.x) && finite(label.y)
      ? {
          x: (label.x ?? 0) + (label.width ?? 0) / 2 + offsetX,
          y: (label.y ?? 0) + (label.height ?? 0) / 2 + offsetY,
        }
      : getPolylineMidpoint(points);

  return {
    edgeId: edge.id,
    source: edge.source,
    target: edge.target,
    sourcePortId: edge.sourcePortId,
    targetPortId: edge.targetPortId,
    label: edge.label,
    kind: edge.kind,
    points,
    labelPosition,
  };
}

function flattenSections(sections: readonly ElkEdgeSection[]): ElkPoint[] {
  const sorted = [...sections].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const points: ElkPoint[] = [];
  sorted.forEach((section) => {
    const sectionPoints = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ];
    sectionPoints.forEach((point) => {
      const previous = points.at(-1);
      if (!previous || previous.x !== point.x || previous.y !== point.y) {
        points.push(point);
      }
    });
  });
  return points;
}

function getResolvedPortOffset(
  assignment: PortAssignment,
  node: ElkNode | undefined,
  port: ElkPort | undefined,
) {
  const nodeWidth = node?.width ?? OUTLINE_NODE_WIDTH;
  const nodeHeight = node?.height ?? OUTLINE_NODE_HEIGHT;
  const relativeX = port?.x ?? 0;
  const relativeY = port?.y ?? 0;
  if (assignment.side === 'north' || assignment.side === 'south') {
    return clampUnit(
      (relativeX + (port?.width ?? 0) / 2) / nodeWidth,
      assignment.offset,
    );
  }
  return clampUnit(
    (relativeY + (port?.height ?? 0) / 2) / nodeHeight,
    assignment.offset,
  );
}

export function validateOutlineRoutes(
  nodes: readonly PositionedOutlineNode[],
  routes: readonly OutlineEdgeRoute[],
): string[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const errors: string[] = [];
  const seen = new Set<string>();

  routes.forEach((route) => {
    if (seen.has(route.edgeId)) {
      errors.push(`${route.edgeId}:duplicate`);
      return;
    }
    seen.add(route.edgeId);
    if (
      route.points.length < 2 ||
      route.points.some((point) => !finite(point.x) || !finite(point.y))
    ) {
      errors.push(`${route.edgeId}:missing-points`);
      return;
    }
    route.points.slice(1).forEach((point, index) => {
      const previous = route.points[index];
      if (
        Math.abs(point.x - previous.x) > EPSILON &&
        Math.abs(point.y - previous.y) > EPSILON
      ) {
        errors.push(`${route.edgeId}:diagonal-segment`);
      }
    });

    const source = nodeById.get(route.source);
    const target = nodeById.get(route.target);
    if (!source || !target) {
      errors.push(`${route.edgeId}:missing-node`);
      return;
    }
    const start = route.points[0];
    const end = route.points.at(-1);
    if (!pointTouchesNodeBoundary(start, source)) {
      errors.push(`${route.edgeId}:source-not-port`);
    }
    if (!pointTouchesNodeBoundary(end, target)) {
      errors.push(`${route.edgeId}:target-not-port`);
    }
    route.points.slice(1).forEach((point, index) => {
      const previous = route.points[index];
      nodes.forEach((node) => {
        if (node.id === route.source || node.id === route.target) return;
        if (segmentIntersectsInterior(previous, point, node)) {
          errors.push(`${route.edgeId}:through-${node.id}`);
        }
      });
    });
  });

  return [...new Set(errors)];
}

function pointTouchesNodeBoundary(
  point: OutlineRoutePoint | undefined,
  node: PositionedOutlineNode,
) {
  if (!point) return false;
  const tolerance = 8;
  const left = node.x;
  const right = node.x + OUTLINE_NODE_WIDTH;
  const top = node.y;
  const bottom = node.y + OUTLINE_NODE_HEIGHT;
  const insideY = point.y >= top - tolerance && point.y <= bottom + tolerance;
  const insideX = point.x >= left - tolerance && point.x <= right + tolerance;
  return (
    ((Math.abs(point.x - left) <= tolerance ||
      Math.abs(point.x - right) <= tolerance) &&
      insideY) ||
    ((Math.abs(point.y - top) <= tolerance ||
      Math.abs(point.y - bottom) <= tolerance) &&
      insideX)
  );
}

function segmentIntersectsInterior(
  start: OutlineRoutePoint,
  end: OutlineRoutePoint,
  node: PositionedOutlineNode,
) {
  const left = node.x + 2;
  const right = node.x + OUTLINE_NODE_WIDTH - 2;
  const top = node.y + 2;
  const bottom = node.y + OUTLINE_NODE_HEIGHT - 2;
  if (Math.abs(start.x - end.x) <= EPSILON) {
    const x = start.x;
    const from = Math.min(start.y, end.y);
    const to = Math.max(start.y, end.y);
    return x > left && x < right && to > top && from < bottom;
  }
  if (Math.abs(start.y - end.y) <= EPSILON) {
    const y = start.y;
    const from = Math.min(start.x, end.x);
    const to = Math.max(start.x, end.x);
    return y > top && y < bottom && to > left && from < right;
  }
  return true;
}

function findRouteCrossings(routes: OutlineEdgeRoute[]) {
  const crossings: {
    route: OutlineEdgeRoute;
    crossing: OutlineRouteCrossing;
  }[] = [];
  routes.forEach((route, routeIndex) => {
    route.points.slice(1).forEach((end, segmentIndex) => {
      const start = route.points[segmentIndex];
      routes.slice(routeIndex + 1).forEach((other) => {
        other.points.slice(1).forEach((otherEnd, otherSegmentIndex) => {
          const otherStart = other.points[otherSegmentIndex];
          const intersection = getOrthogonalIntersection(
            start,
            end,
            otherStart,
            otherEnd,
          );
          if (!intersection) return;
          const routeHorizontal = Math.abs(start.y - end.y) <= EPSILON;
          const otherHorizontal =
            Math.abs(otherStart.y - otherEnd.y) <= EPSILON;
          if (routeHorizontal === otherHorizontal) return;
          const crossing = {
            ...intersection,
            orientation: routeHorizontal ? 'horizontal' : 'vertical',
          } satisfies OutlineRouteCrossing;
          crossings.push({ route: routeHorizontal ? route : other, crossing });
        });
      });
    });
  });
  return crossings;
}

function getOrthogonalIntersection(
  start: OutlineRoutePoint,
  end: OutlineRoutePoint,
  otherStart: OutlineRoutePoint,
  otherEnd: OutlineRoutePoint,
): OutlineRoutePoint | null {
  const horizontal = Math.abs(start.y - end.y) <= EPSILON;
  const otherHorizontal = Math.abs(otherStart.y - otherEnd.y) <= EPSILON;
  if (horizontal === otherHorizontal) return null;
  const horizontalStart = horizontal ? start : otherStart;
  const horizontalEnd = horizontal ? end : otherEnd;
  const verticalStart = horizontal ? otherStart : start;
  const verticalEnd = horizontal ? otherEnd : end;
  const x = verticalStart.x;
  const y = horizontalStart.y;
  if (
    x <= Math.min(horizontalStart.x, horizontalEnd.x) + 2 ||
    x >= Math.max(horizontalStart.x, horizontalEnd.x) - 2 ||
    y <= Math.min(verticalStart.y, verticalEnd.y) + 2 ||
    y >= Math.max(verticalStart.y, verticalEnd.y) - 2
  ) {
    return null;
  }
  return { x, y };
}

function getPolylineMidpoint(
  points: readonly OutlineRoutePoint[],
): OutlineRoutePoint | undefined {
  if (!points.length) return undefined;
  const lengths = points
    .slice(1)
    .map((point, index) =>
      Math.hypot(point.x - points[index].x, point.y - points[index].y),
    );
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return points[0];
  let cursor = total / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    if (cursor <= lengths[index]) {
      const start = points[index];
      const end = points[index + 1];
      const ratio = lengths[index] ? cursor / lengths[index] : 0;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      };
    }
    cursor -= lengths[index];
  }
  return points.at(-1);
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampUnit(value: number, fallback: number) {
  return Number.isFinite(value)
    ? Math.max(0.05, Math.min(0.95, value))
    : fallback;
}

function compareNodes(left: OutlineNode, right: OutlineNode) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function compareEdges(left: OutlineEdge, right: OutlineEdge) {
  const kindRank = (kind: OutlineEdge['kind']) => (kind === 'sequence' ? 0 : 1);
  return (
    kindRank(left.kind) - kindRank(right.kind) ||
    left.id.localeCompare(right.id)
  );
}
