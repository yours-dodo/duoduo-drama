import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineEdgePort,
  type OutlineEdgeRoute,
  type OutlineLayout,
  type OutlineMode,
  type OutlineNode,
  type OutlinePosition,
  type OutlinePositionMap,
  type OutlineRoutePoint,
  type OutlineView,
  type PositionedOutlineNode,
} from './story-outline-types';

export type OutlineDocument = {
  nodes: OutlineNode[];
  edges: OutlineEdge[];
};

const GRID_GAP_X = 320;
const GRID_GAP_Y = 160;
const FISHBONE_MAINLINE_Y = 316;
const MINDMAP_CENTER = { x: 680, y: 420 };
const LOGIC_LAYER_GAP_X = 256;
const LOGIC_MAINLINE_Y = 280;
const LOGIC_BRANCH_GAP_Y = 172;
const HORIZONTAL_TIMELINE_AXIS_Y = 420;
const HORIZONTAL_TIMELINE_PRIMARY_GAP_X = 280;
const HORIZONTAL_TIMELINE_GROUP_GAP_X = 128;
const HORIZONTAL_TIMELINE_BRANCH_OFFSET_X = 300;
const HORIZONTAL_TIMELINE_BRANCH_DEPTH_GAP_X = 280;
const HORIZONTAL_TIMELINE_BRANCH_OFFSET_Y = 180;
const HORIZONTAL_TIMELINE_BRANCH_GAP_Y = 144;
const HORIZONTAL_TIMELINE_GROUP_GAP_Y = 72;
const HORIZONTAL_TIMELINE_ROUTE_CORNER_RADIUS = 24;
const HORIZONTAL_TIMELINE_ROUTE_CORNER_CLEARANCE =
  HORIZONTAL_TIMELINE_ROUTE_CORNER_RADIUS * 2;
const HORIZONTAL_TIMELINE_ROUTE_STUB = 24;
const HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP = 24;
const OUTLINE_NODE_COLLISION_GAP = 32;

export function createOutlineSeed(): OutlineDocument {
  return {
    nodes: [
      {
        id: 'outline-core',
        title: '一封未寄出的信',
        summary: '一个关于记忆、选择与真相的故事核心。',
        type: 'chapter',
        order: 0,
        lane: '主线',
      },
      {
        id: 'outline-letter',
        title: '雨夜来信',
        summary: '林遥收到一封来自十年前的信，寄件人已经失踪。',
        type: 'event',
        parentId: 'outline-core',
        order: 1,
        lane: '主线',
      },
      {
        id: 'outline-lin',
        title: '林遥',
        summary: '地方档案馆修复师，习惯相信证据而不是记忆。',
        type: 'character',
        parentId: 'outline-letter',
        order: 2,
        lane: '人物',
      },
      {
        id: 'outline-archive',
        title: '旧档案重见天日',
        summary: '一份被替换过的城市事故档案，指向林遥的家人。',
        type: 'event',
        parentId: 'outline-core',
        order: 3,
        lane: '主线',
      },
      {
        id: 'outline-truth',
        title: '被掩埋的真相',
        summary: '真相一旦公开，整座城市的秩序都要重新解释。',
        parentId: 'outline-archive',
        type: 'conflict',
        order: 4,
        lane: '冲突',
      },
      {
        id: 'outline-zhou',
        title: '周砚',
        summary: '事故调查组旧成员，试图阻止林遥继续追查。',
        type: 'character',
        parentId: 'outline-truth',
        order: 5,
        lane: '人物',
      },
      {
        id: 'outline-choice',
        title: '选择公开真相',
        summary: '林遥必须决定，是保护现在的人，还是还原过去。',
        type: 'event',
        parentId: 'outline-core',
        order: 6,
        lane: '主线',
      },
      {
        id: 'outline-ending',
        title: '城市恢复了安静',
        summary: '答案被写进新的档案，代价留在每个人的生活里。',
        type: 'chapter',
        parentId: 'outline-choice',
        order: 7,
        lane: '主线',
      },
    ],
    edges: [
      {
        id: 'edge-letter-archive',
        source: 'outline-letter',
        target: 'outline-archive',
        label: '引出',
        kind: 'sequence',
      },
      {
        id: 'edge-lin-archive',
        source: 'outline-lin',
        target: 'outline-archive',
        label: '追查',
        kind: 'relation',
      },
      {
        id: 'edge-archive-truth',
        source: 'outline-archive',
        target: 'outline-truth',
        label: '揭开',
        kind: 'sequence',
      },
      {
        id: 'edge-zhou-choice',
        source: 'outline-zhou',
        target: 'outline-choice',
        label: '阻止',
        kind: 'relation',
      },
      {
        id: 'edge-truth-choice',
        source: 'outline-truth',
        target: 'outline-choice',
        label: '逼迫',
        kind: 'sequence',
      },
      {
        id: 'edge-choice-ending',
        source: 'outline-choice',
        target: 'outline-ending',
        label: '结果',
        kind: 'sequence',
      },
    ],
  };
}

export function getViewsForMode(mode: OutlineMode): OutlineView[] {
  return mode === 'timeline'
    ? ['timeline-horizontal', 'timeline-vertical', 'timeline-fishbone']
    : ['organization-logic', 'organization-mindmap'];
}

export function getDefaultView(mode: OutlineMode): OutlineView {
  return mode === 'timeline' ? 'timeline-horizontal' : 'organization-mindmap';
}

export function getModeForView(view: OutlineView): OutlineMode {
  return view.startsWith('timeline') ? 'timeline' : 'organization';
}

export function buildOutlineLayout(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  view: OutlineView,
  overrides: OutlinePositionMap = {},
): OutlineLayout {
  const basePositions = getBasePositions(nodes, edges, view);
  const baseNodes = Object.values(basePositions);
  const baseMinX = baseNodes.length
    ? Math.min(...baseNodes.map((position) => position.x))
    : 40;
  const baseMinY = baseNodes.length
    ? Math.min(...baseNodes.map((position) => position.y))
    : 40;
  const baseOffsetX = Math.max(0, 40 - baseMinX);
  const baseOffsetY = Math.max(0, 40 - baseMinY);
  const desiredNodes = nodes.map((node) => {
    const manualPosition = overrides[node.id];
    const basePosition = basePositions[node.id];
    const position =
      manualPosition ??
      (basePosition
        ? {
            x: basePosition.x + baseOffsetX,
            y: basePosition.y + baseOffsetY,
          }
        : { x: 80, y: 80 });
    return {
      ...node,
      x: position.x,
      y: position.y,
    };
  });
  const positionedNodes = resolveOutlineNodeCollisions(
    desiredNodes,
    view,
    overrides,
  );

  const maxX = positionedNodes.reduce(
    (value, node) => Math.max(value, node.x + OUTLINE_NODE_WIDTH),
    960,
  );
  const maxY = positionedNodes.reduce(
    (value, node) => Math.max(value, node.y + OUTLINE_NODE_HEIGHT),
    520,
  );

  const layout: OutlineLayout = {
    width: Math.max(maxX + 120, view === 'timeline-vertical' ? 720 : 1120),
    height: Math.max(maxY + 100, view === 'timeline-horizontal' ? 560 : 680),
    nodes: positionedNodes,
  };

  if (view === 'timeline-horizontal') {
    const routes = buildHorizontalTimelineRoutes(positionedNodes, edges);
    layout.edgeRoutes = routes.edgeRoutes;
    layout.edgePorts = routes.edgePorts;
    const routePoints = routes.edgeRoutes.flatMap(
      (route) => route.subpaths?.flat() ?? route.points,
    );
    const routeMaxX = Math.max(...routePoints.map((point) => point.x), 0);
    const routeMaxY = Math.max(...routePoints.map((point) => point.y), 0);
    layout.width = Math.max(
      layout.width,
      routeMaxX + 120,
      Math.max(
        ...positionedNodes.map((node) => node.x + OUTLINE_NODE_WIDTH),
        0,
      ) + 120,
    );
    layout.height = Math.max(
      layout.height,
      routeMaxY + 100,
      Math.max(
        ...positionedNodes.map((node) => node.y + OUTLINE_NODE_HEIGHT),
        0,
      ) + 100,
    );
  }

  return layout;
}

function resolveOutlineNodeCollisions(
  nodes: PositionedOutlineNode[],
  view: OutlineView,
  overrides: OutlinePositionMap,
) {
  const sourceIndex = new Map(nodes.map((node, index) => [node.id, index]));
  const placementOrder = [...nodes].sort((left, right) => {
    const manualDifference =
      Number(Boolean(overrides[left.id])) -
      Number(Boolean(overrides[right.id]));
    if (manualDifference) return manualDifference;
    return (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0);
  });
  const placed: PositionedOutlineNode[] = [];
  const resolved = new Map<string, PositionedOutlineNode>();

  placementOrder.forEach((node) => {
    const position = findNearestCollisionFreePosition(node, placed, view);
    const positioned = { ...node, ...position };
    placed.push(positioned);
    resolved.set(node.id, positioned);
  });

  return nodes.map((node) => resolved.get(node.id) ?? node);
}

function findNearestCollisionFreePosition(
  node: PositionedOutlineNode,
  placed: PositionedOutlineNode[],
  view: OutlineView,
): OutlinePosition {
  const desired = { x: node.x, y: node.y };
  if (!hasOutlineNodeCollision(desired, placed)) return desired;

  const vertical = view !== 'timeline-vertical';
  const step = vertical
    ? OUTLINE_NODE_HEIGHT + OUTLINE_NODE_COLLISION_GAP
    : OUTLINE_NODE_WIDTH + OUTLINE_NODE_COLLISION_GAP;
  const preferredDirection = getCollisionNudgeDirection(node, view);
  const maxAttempts = Math.max(placed.length * 2 + 4, 12);

  for (let distance = 1; distance <= maxAttempts; distance += 1) {
    for (const direction of [preferredDirection, -preferredDirection]) {
      const candidate = vertical
        ? { x: desired.x, y: desired.y + direction * distance * step }
        : { x: desired.x + direction * distance * step, y: desired.y };
      if (!hasOutlineNodeCollision(candidate, placed)) return candidate;
    }
  }

  let distance = maxAttempts + 1;
  while (true) {
    const candidate = vertical
      ? {
          x: desired.x,
          y: desired.y + preferredDirection * distance * step,
        }
      : {
          x: desired.x + preferredDirection * distance * step,
          y: desired.y,
        };
    if (!hasOutlineNodeCollision(candidate, placed)) return candidate;
    distance += 1;
  }
}

function getCollisionNudgeDirection(
  node: PositionedOutlineNode,
  view: OutlineView,
) {
  if (view === 'timeline-horizontal') {
    return node.y < HORIZONTAL_TIMELINE_AXIS_Y ? -1 : 1;
  }
  if (view === 'timeline-fishbone') {
    return node.y < FISHBONE_MAINLINE_Y ? -1 : 1;
  }
  if (view === 'timeline-vertical') {
    return node.x < 84 ? -1 : 1;
  }
  return node.order % 2 === 0 ? -1 : 1;
}

function hasOutlineNodeCollision(
  position: OutlinePosition,
  placed: PositionedOutlineNode[],
) {
  return placed.some(
    (node) =>
      position.x < node.x + OUTLINE_NODE_WIDTH + OUTLINE_NODE_COLLISION_GAP &&
      position.x + OUTLINE_NODE_WIDTH + OUTLINE_NODE_COLLISION_GAP > node.x &&
      position.y < node.y + OUTLINE_NODE_HEIGHT + OUTLINE_NODE_COLLISION_GAP &&
      position.y + OUTLINE_NODE_HEIGHT + OUTLINE_NODE_COLLISION_GAP > node.y,
  );
}

function getBasePositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  view: OutlineView,
): OutlinePositionMap {
  switch (view) {
    case 'timeline-horizontal':
      return getHorizontalTimelinePositions(nodes, edges);
    case 'timeline-vertical':
      return getVerticalTimelinePositions(nodes, edges);
    case 'timeline-fishbone':
      return getFishbonePositions(nodes, edges);
    case 'organization-logic':
      return getLogicPositions(nodes, edges);
    case 'organization-mindmap':
      return getMindmapPositions(nodes);
  }
}

function getHorizontalTimelinePositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlinePositionMap {
  const mainlineNodes = getTimelineMainlineNodes(nodes, edges);
  const mainlineIds = new Set(mainlineNodes.map((node) => node.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const positions: OutlinePositionMap = {};
  const branchesByAnchor = new Map<string, OutlineNode[]>();
  nodes
    .filter((node) => !mainlineIds.has(node.id))
    .sort(compareByOrder)
    .forEach((node) => {
      const anchorId = getHorizontalTimelineAnchor(
        node,
        nodesById,
        mainlineIds,
        mainlineNodes,
        edges,
      );
      const branches = branchesByAnchor.get(anchorId) ?? [];
      branches.push(node);
      branchesByAnchor.set(anchorId, branches);
    });

  const branchNodes = nodes.filter((node) => !mainlineIds.has(node.id));
  const maxBranchDepth = branchNodes.reduce(
    (depth, node) =>
      Math.max(
        depth,
        getHorizontalTimelineBranchDepth(node, nodesById, mainlineIds),
      ),
    0,
  );
  const branchZoneWidth = branchNodes.length
    ? HORIZONTAL_TIMELINE_BRANCH_OFFSET_X +
      maxBranchDepth * HORIZONTAL_TIMELINE_BRANCH_DEPTH_GAP_X +
      OUTLINE_NODE_WIDTH
    : 0;
  const primaryPitch = Math.max(
    OUTLINE_NODE_WIDTH + HORIZONTAL_TIMELINE_PRIMARY_GAP_X,
    branchZoneWidth ? branchZoneWidth + HORIZONTAL_TIMELINE_GROUP_GAP_X : 0,
  );
  const nextPrimaryX = 80 + mainlineNodes.length * primaryPitch;
  const sideHeights = { top: 0, bottom: 0 };
  mainlineNodes.forEach((node, index) => {
    positions[node.id] = {
      x: 80 + index * primaryPitch,
      y: HORIZONTAL_TIMELINE_AXIS_Y,
    };

    const branches = branchesByAnchor.get(node.id) ?? [];
    if (!branches.length) return;

    const side = chooseHorizontalTimelineBranchSide(index, sideHeights);
    const group = placeHorizontalTimelineBranchGroup(
      node,
      branches,
      mainlineIds,
      positions,
      side,
    );
    sideHeights[side] += group.height + HORIZONTAL_TIMELINE_GROUP_GAP_Y;
  });

  const unplaced = nodes
    .filter((node) => !positions[node.id])
    .sort(compareByOrder);
  unplaced.forEach((node, index) => {
    positions[node.id] = {
      x: nextPrimaryX + index * (OUTLINE_NODE_WIDTH + 96),
      y: HORIZONTAL_TIMELINE_AXIS_Y,
    };
  });

  return positions;
}

function chooseHorizontalTimelineBranchSide(
  primaryIndex: number,
  sideHeights: { top: number; bottom: number },
): 'top' | 'bottom' {
  if (sideHeights.top < sideHeights.bottom) return 'top';
  if (sideHeights.bottom < sideHeights.top) return 'bottom';
  return primaryIndex % 2 === 0 ? 'top' : 'bottom';
}

function getHorizontalTimelineBranchDepth(
  node: OutlineNode,
  nodesById: Map<string, OutlineNode>,
  mainlineIds: Set<string>,
) {
  let depth = 0;
  let current = node;
  const visited = new Set<string>();
  while (current.parentId && !mainlineIds.has(current.parentId)) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    depth += 1;
    const parent = nodesById.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return depth;
}

function placeHorizontalTimelineBranchGroup(
  anchor: OutlineNode,
  branches: OutlineNode[],
  mainlineIds: Set<string>,
  positions: OutlinePositionMap,
  side: 'top' | 'bottom',
) {
  const branchIds = new Set(branches.map((node) => node.id));
  const anchorPosition = positions[anchor.id] ?? {
    x: 80,
    y: HORIZONTAL_TIMELINE_AXIS_Y,
  };
  const childrenByParent = new Map<string, OutlineNode[]>();
  branches.forEach((node) => {
    if (!node.parentId || mainlineIds.has(node.parentId)) return;
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  });
  childrenByParent.forEach((children) => children.sort(compareByOrder));

  const roots = branches
    .filter(
      (node) =>
        !node.parentId ||
        node.parentId === anchor.id ||
        !branchIds.has(node.parentId) ||
        mainlineIds.has(node.parentId),
    )
    .sort(compareByOrder);

  let cursor = 0;
  let maxDepth = 0;
  const visited = new Set<string>();

  const placeNode = (node: OutlineNode, depth: number): number => {
    if (visited.has(node.id)) return cursor;
    visited.add(node.id);
    maxDepth = Math.max(maxDepth, depth);
    const children = (childrenByParent.get(node.id) ?? []).filter(
      (child) => child.id !== node.id,
    );

    if (!children.length) {
      const slot = cursor;
      cursor += HORIZONTAL_TIMELINE_BRANCH_GAP_Y;
      positions[node.id] = {
        x:
          anchorPosition.x +
          HORIZONTAL_TIMELINE_BRANCH_OFFSET_X +
          depth * HORIZONTAL_TIMELINE_BRANCH_DEPTH_GAP_X,
        y:
          side === 'top'
            ? HORIZONTAL_TIMELINE_AXIS_Y -
              HORIZONTAL_TIMELINE_BRANCH_OFFSET_Y -
              slot
            : HORIZONTAL_TIMELINE_AXIS_Y +
              HORIZONTAL_TIMELINE_BRANCH_OFFSET_Y +
              slot,
      };
      return slot;
    }

    const childSlots = children.map((child) => placeNode(child, depth + 1));
    const firstSlot = childSlots[0] ?? cursor;
    const lastSlot = childSlots.at(-1) ?? firstSlot;
    const slot = (firstSlot + lastSlot) / 2;
    positions[node.id] = {
      x:
        anchorPosition.x +
        HORIZONTAL_TIMELINE_BRANCH_OFFSET_X +
        depth * HORIZONTAL_TIMELINE_BRANCH_DEPTH_GAP_X,
      y:
        side === 'top'
          ? HORIZONTAL_TIMELINE_AXIS_Y -
            HORIZONTAL_TIMELINE_BRANCH_OFFSET_Y -
            slot
          : HORIZONTAL_TIMELINE_AXIS_Y +
            HORIZONTAL_TIMELINE_BRANCH_OFFSET_Y +
            slot,
    };
    return slot;
  };

  roots.forEach((root) => placeNode(root, 0));

  branches
    .filter((node) => !visited.has(node.id))
    .sort(compareByOrder)
    .forEach((node) => placeNode(node, 0));

  const height = Math.max(cursor, HORIZONTAL_TIMELINE_BRANCH_GAP_Y);
  const width =
    HORIZONTAL_TIMELINE_BRANCH_OFFSET_X +
    maxDepth * HORIZONTAL_TIMELINE_BRANCH_DEPTH_GAP_X +
    OUTLINE_NODE_WIDTH;
  return { height, width };
}

function getTimelineMainlineNodes(nodes: OutlineNode[], edges: OutlineEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const sequenceEdges = edges.filter(
    (edge) =>
      edge.kind === 'sequence' &&
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target),
  );
  const anchors = new Set(
    nodes
      .filter((node) => node.lane === '主线' || node.type === 'chapter')
      .map((node) => node.id),
  );
  const mainlineIds = new Set(anchors);

  if (anchors.size) {
    const forward = walkSequenceGraph(sequenceEdges, anchors, 'forward');
    const backward = walkSequenceGraph(sequenceEdges, anchors, 'backward');
    nodes.forEach((node) => {
      if (forward.has(node.id) && backward.has(node.id)) {
        mainlineIds.add(node.id);
      }
    });
  } else if (sequenceEdges.length) {
    getLongestSequencePath(nodes, sequenceEdges).forEach((nodeId) =>
      mainlineIds.add(nodeId),
    );
  }

  if (!mainlineIds.size) {
    nodes
      .filter((node) => node.type !== 'character')
      .forEach((node) => mainlineIds.add(node.id));
  }

  return nodes.filter((node) => mainlineIds.has(node.id)).sort(compareByOrder);
}

function walkSequenceGraph(
  edges: OutlineEdge[],
  starts: Set<string>,
  direction: 'forward' | 'backward',
) {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    const from = direction === 'forward' ? edge.source : edge.target;
    const to = direction === 'forward' ? edge.target : edge.source;
    const neighbors = adjacency.get(from) ?? [];
    neighbors.push(to);
    adjacency.set(from, neighbors);
  });

  const visited = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    (adjacency.get(current) ?? []).forEach((neighbor) => {
      if (!visited.has(neighbor)) stack.push(neighbor);
    });
  }
  return visited;
}

function getLongestSequencePath(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): string[] {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    const next = adjacency.get(edge.source) ?? [];
    next.push(edge.target);
    adjacency.set(edge.source, next);
  });
  adjacency.forEach((next) => next.sort(compareIds));

  let best: string[] = [];
  const visit = (nodeId: string, path: string[], seen: Set<string>) => {
    const current = [...path, nodeId];
    const children = (adjacency.get(nodeId) ?? []).filter(
      (child) => !seen.has(child),
    );
    if (!children.length && current.length > best.length) {
      best = current;
      return;
    }
    children.forEach((child) => {
      const nextSeen = new Set(seen).add(child);
      visit(child, current, nextSeen);
    });
  };

  const sourceIds = new Set(edges.map((edge) => edge.source));
  const targets = new Set(edges.map((edge) => edge.target));
  const roots = nodes
    .filter((node) => sourceIds.has(node.id) && !targets.has(node.id))
    .sort(compareByOrder);
  (roots.length ? roots : nodes.filter((node) => sourceIds.has(node.id)))
    .sort(compareByOrder)
    .forEach((node) => visit(node.id, [], new Set([node.id])));
  return best;
}

function compareIds(left: string, right: string) {
  return left.localeCompare(right);
}

function getHorizontalTimelineAnchor(
  node: OutlineNode,
  nodesById: Map<string, OutlineNode>,
  mainlineIds: Set<string>,
  mainlineNodes: OutlineNode[],
  edges: OutlineEdge[],
) {
  const visited = new Set<string>();
  let current: OutlineNode | undefined = node;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    if (current.parentId && mainlineIds.has(current.parentId)) {
      return current.parentId;
    }
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }

  const connectedMainline = edges
    .filter(
      (edge) =>
        (edge.source === node.id && mainlineIds.has(edge.target)) ||
        (edge.target === node.id && mainlineIds.has(edge.source)),
    )
    .map((edge) => (edge.source === node.id ? edge.target : edge.source));
  if (connectedMainline.length) return connectedMainline[0];

  return (
    mainlineNodes.find((candidate) => candidate.order >= node.order)?.id ??
    mainlineNodes.at(-1)?.id ??
    node.id
  );
}

function buildHorizontalTimelineRoutes(
  nodes: PositionedOutlineNode[],
  edges: OutlineEdge[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const mainlineNodes = getTimelineMainlineNodes(nodes, edges);
  const mainlineIds = new Set(mainlineNodes.map((node) => node.id));
  const routes: OutlineEdgeRoute[] = [];
  const endpointSides = new Map<string, OutlineEdgePort['side']>();
  const addRoute = (
    edgeId: string,
    source: PositionedOutlineNode,
    target: PositionedOutlineNode,
    options: {
      label?: string;
      kind?: OutlineEdge['kind'];
      decorative?: boolean;
      decorativeRole?: 'axis' | 'branch';
      hidden?: boolean;
      sourceSide?: OutlineEdgePort['side'];
      targetSide?: OutlineEdgePort['side'];
      points?: OutlineRoutePoint[];
      subpaths?: OutlineRoutePoint[][];
      cornerRadius?: number;
    } = {},
  ) => {
    const sourceSide =
      options.sourceSide ??
      getHorizontalTimelineSourceSide(source, target, mainlineIds);
    const targetSide =
      options.targetSide ??
      getHorizontalTimelineTargetSide(source, target, mainlineIds);
    endpointSides.set(`${edgeId}:source`, sourceSide);
    endpointSides.set(`${edgeId}:target`, targetSide);
    const routePoints =
      options.points ??
      getObstacleAwareTimelinePoints(
        source,
        target,
        sourceSide,
        targetSide,
        nodes,
      );
    routes.push({
      edgeId,
      source: source.id,
      target: target.id,
      sourcePortId: `timeline-${edgeId}-source`,
      targetPortId: `timeline-${edgeId}-target`,
      label: options.label,
      kind: options.kind,
      decorative: options.decorative,
      decorativeRole: options.decorativeRole,
      hidden: options.hidden,
      points: routePoints,
      subpaths: options.subpaths,
      cornerRadius: options.cornerRadius,
      labelPosition: getRouteMidpoint(routePoints),
    });
  };

  const axisPairs = new Set<string>();
  mainlineNodes.slice(1).forEach((target, index) => {
    const source = mainlineNodes[index];
    axisPairs.add(`${source.id}->${target.id}`);
    addRoute(`timeline-axis-${source.id}-${target.id}`, source, target, {
      kind: 'sequence',
      decorative: true,
      decorativeRole: 'axis',
      cornerRadius: 0,
    });
  });

  const hierarchyPairs = new Set<string>();
  const branchGroups = new Map<
    string,
    {
      source: PositionedOutlineNode;
      sourceSide: OutlineEdgePort['side'];
      targetSide: OutlineEdgePort['side'];
      targets: PositionedOutlineNode[];
    }
  >();
  nodes
    .filter((node) => !mainlineIds.has(node.id))
    .sort(compareByOrder)
    .forEach((node) => {
      const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
      const anchorId = getHorizontalTimelineAnchor(
        node,
        nodesById,
        mainlineIds,
        mainlineNodes,
        edges,
      );
      const source =
        parent && !mainlineIds.has(parent.id)
          ? parent
          : nodesById.get(anchorId);
      if (!source || source.id === node.id) return;

      hierarchyPairs.add(`${source.id}->${node.id}`);
      const sourceSide: OutlineEdgePort['side'] = mainlineIds.has(source.id)
        ? node.y < source.y
          ? 'north'
          : 'south'
        : node.x >= source.x
          ? 'east'
          : 'west';
      const targetSide: OutlineEdgePort['side'] =
        node.x >= source.x ? 'west' : 'east';
      const canUseSharedSpine = node.x > source.x && targetSide === 'west';
      const groupKey = canUseSharedSpine
        ? `${source.id}:${sourceSide}:${targetSide}`
        : `${source.id}:${node.id}:${sourceSide}:${targetSide}`;
      const group = branchGroups.get(groupKey) ?? {
        source,
        sourceSide,
        targetSide,
        targets: [],
      };
      group.targets.push(node);
      branchGroups.set(groupKey, group);
    });

  branchGroups.forEach(({ source, sourceSide, targetSide, targets }) => {
    targets.sort(compareByOrder);
    const canShareSpine =
      targetSide === 'west' && targets.every((target) => target.x > source.x);
    if (!canShareSpine) {
      targets.forEach((target) => {
        addRoute(`timeline-branch-${source.id}-${target.id}`, source, target, {
          kind: 'sequence',
          decorative: true,
          decorativeRole: 'branch',
          sourceSide,
          targetSide,
          cornerRadius: HORIZONTAL_TIMELINE_ROUTE_CORNER_RADIUS,
        });
      });
      return;
    }

    const geometry = getSharedBranchRouteGeometry(
      source,
      targets,
      sourceSide,
      targetSide,
    );
    const edgeId =
      targets.length === 1
        ? `timeline-branch-${source.id}-${targets[0].id}`
        : `timeline-branch-group-${source.id}-${sourceSide}-${targetSide}`;
    addRoute(edgeId, source, geometry.target, {
      kind: 'sequence',
      decorative: true,
      decorativeRole: 'branch',
      sourceSide,
      targetSide,
      points: geometry.points,
      subpaths: geometry.subpaths,
      cornerRadius: HORIZONTAL_TIMELINE_ROUTE_CORNER_RADIUS,
    });
    if (targets.length > 1) {
      targets.forEach((target) => {
        addRoute(
          `timeline-branch-semantic-${source.id}-${target.id}`,
          source,
          target,
          {
            kind: 'sequence',
            hidden: true,
            points: [],
          },
        );
      });
    }
  });

  edges.forEach((edge) => {
    const pair = `${edge.source}->${edge.target}`;
    if (axisPairs.has(pair) || hierarchyPairs.has(pair)) return;
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) return;
    addRoute(edge.id, source, target, {
      label: edge.label,
      kind: edge.kind,
      cornerRadius: 0,
    });
  });

  const edgePorts: Record<string, OutlineEdgePort> = {};
  routes.forEach((route) => {
    const sourceSide = endpointSides.get(`${route.edgeId}:source`) ?? 'east';
    const targetSide = endpointSides.get(`${route.edgeId}:target`) ?? 'west';
    const sourcePort: OutlineEdgePort = {
      id: route.sourcePortId,
      edgeId: route.edgeId,
      nodeId: route.source,
      kind: 'source',
      side: sourceSide,
      offset: 0.5,
    };
    const targetPort: OutlineEdgePort = {
      id: route.targetPortId,
      edgeId: route.edgeId,
      nodeId: route.target,
      kind: 'target',
      side: targetSide,
      offset: 0.5,
    };
    edgePorts[sourcePort.id] = sourcePort;
    edgePorts[targetPort.id] = targetPort;
  });

  return { edgeRoutes: routes, edgePorts };
}

function getSharedBranchRouteGeometry(
  source: PositionedOutlineNode,
  targets: PositionedOutlineNode[],
  sourceSide: OutlineEdgePort['side'],
  targetSide: OutlineEdgePort['side'],
) {
  const sourcePoint = getNodeBoundaryPoint(source, sourceSide);
  const targetEntries = targets.map((target) => ({
    target,
    point: getNodeBoundaryPoint(target, targetSide),
  }));
  const spineX = sourcePoint.x;
  const owner = targetEntries.reduce((farthest, entry) =>
    Math.abs(entry.point.y - sourcePoint.y) >
    Math.abs(farthest.point.y - sourcePoint.y)
      ? entry
      : farthest,
  );
  const points = dedupeRoutePoints([
    sourcePoint,
    { x: spineX, y: sourcePoint.y },
    { x: spineX, y: owner.point.y },
    owner.point,
  ]);

  if (targetEntries.length === 1) {
    return { target: owner.target, points };
  }

  const backbone = dedupeRoutePoints([
    sourcePoint,
    { x: spineX, y: sourcePoint.y },
    { x: spineX, y: owner.point.y },
  ]);
  const twigs = targetEntries.map(({ point }) => {
    if (point.y === sourcePoint.y) {
      return dedupeRoutePoints([{ x: spineX, y: point.y }, point]);
    }
    const incomingDirection = point.y > sourcePoint.y ? -1 : 1;
    return dedupeRoutePoints([
      {
        x: spineX,
        y:
          point.y +
          incomingDirection * HORIZONTAL_TIMELINE_ROUTE_CORNER_CLEARANCE,
      },
      { x: spineX, y: point.y },
      point,
    ]);
  });

  return {
    target: owner.target,
    points,
    subpaths: [backbone, ...twigs],
  };
}

function getHorizontalTimelineSourceSide(
  source: PositionedOutlineNode,
  target: PositionedOutlineNode,
  mainlineIds: Set<string>,
): OutlineEdgePort['side'] {
  if (mainlineIds.has(source.id) && mainlineIds.has(target.id)) return 'east';
  if (mainlineIds.has(source.id)) {
    return target.y < source.y ? 'north' : 'south';
  }
  return target.x >= source.x ? 'east' : 'west';
}

function getHorizontalTimelineTargetSide(
  source: PositionedOutlineNode,
  target: PositionedOutlineNode,
  mainlineIds: Set<string>,
): OutlineEdgePort['side'] {
  if (mainlineIds.has(source.id) && mainlineIds.has(target.id)) return 'west';
  if (mainlineIds.has(target.id)) {
    return source.y < target.y ? 'north' : 'south';
  }
  return target.x >= source.x ? 'west' : 'east';
}

function getNodeBoundaryPoint(
  node: PositionedOutlineNode,
  side: OutlineEdgePort['side'],
  offset = 0.5,
): OutlineRoutePoint {
  if (side === 'north') {
    return { x: node.x + OUTLINE_NODE_WIDTH * offset, y: node.y };
  }
  if (side === 'south') {
    return {
      x: node.x + OUTLINE_NODE_WIDTH * offset,
      y: node.y + OUTLINE_NODE_HEIGHT,
    };
  }
  if (side === 'west') {
    return { x: node.x, y: node.y + OUTLINE_NODE_HEIGHT * offset };
  }
  return {
    x: node.x + OUTLINE_NODE_WIDTH,
    y: node.y + OUTLINE_NODE_HEIGHT * offset,
  };
}

type TimelineRouteObstacle = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function getObstacleAwareTimelinePoints(
  sourceNode: PositionedOutlineNode,
  targetNode: PositionedOutlineNode,
  sourceSide: OutlineEdgePort['side'],
  targetSide: OutlineEdgePort['side'],
  nodes: PositionedOutlineNode[],
) {
  const source = getNodeBoundaryPoint(sourceNode, sourceSide);
  const target = getNodeBoundaryPoint(targetNode, targetSide);
  const sourceStub = offsetRoutePoint(
    source,
    sourceSide,
    HORIZONTAL_TIMELINE_ROUTE_STUB,
  );
  const targetStub = offsetRoutePoint(
    target,
    targetSide,
    HORIZONTAL_TIMELINE_ROUTE_STUB,
  );
  const obstacles = nodes.map((node) => {
    const padding =
      node.id === sourceNode.id || node.id === targetNode.id
        ? 0
        : HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP;
    return {
      left: node.x - padding,
      top: node.y - padding,
      right: node.x + OUTLINE_NODE_WIDTH + padding,
      bottom: node.y + OUTLINE_NODE_HEIGHT + padding,
    };
  });
  if (sourceStub.x === targetStub.x || sourceStub.y === targetStub.y) {
    const direct = simplifyOrthogonalRoute([
      source,
      sourceStub,
      targetStub,
      target,
    ]);
    if (isOrthogonalRouteClear(direct, obstacles)) return direct;
  }
  const xGuides = new Set<number>([
    sourceStub.x,
    targetStub.x,
    Math.round((sourceStub.x + targetStub.x) / 2),
  ]);
  const yGuides = new Set<number>([
    sourceStub.y,
    targetStub.y,
    Math.round((sourceStub.y + targetStub.y) / 2),
  ]);
  nodes.forEach((node) => {
    xGuides.add(node.x - HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP);
    xGuides.add(
      node.x + OUTLINE_NODE_WIDTH + HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP,
    );
    yGuides.add(node.y - HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP);
    yGuides.add(
      node.y + OUTLINE_NODE_HEIGHT + HORIZONTAL_TIMELINE_ROUTE_OBSTACLE_GAP,
    );
  });

  const candidates: OutlineRoutePoint[][] = [];
  const candidateKeys = new Set<string>();
  const addCandidate = (points: OutlineRoutePoint[]) => {
    const simplified = simplifyOrthogonalRoute(points);
    const key = simplified.map((point) => `${point.x},${point.y}`).join('|');
    if (
      candidateKeys.has(key) ||
      !isOrthogonalRouteClear(simplified, obstacles)
    ) {
      return;
    }
    candidateKeys.add(key);
    candidates.push(simplified);
  };

  addCandidate([
    source,
    sourceStub,
    { x: targetStub.x, y: sourceStub.y },
    targetStub,
    target,
  ]);
  addCandidate([
    source,
    sourceStub,
    { x: sourceStub.x, y: targetStub.y },
    targetStub,
    target,
  ]);
  xGuides.forEach((x) => {
    addCandidate([
      source,
      sourceStub,
      { x, y: sourceStub.y },
      { x, y: targetStub.y },
      targetStub,
      target,
    ]);
  });
  yGuides.forEach((y) => {
    addCandidate([
      source,
      sourceStub,
      { x: sourceStub.x, y },
      { x: targetStub.x, y },
      targetStub,
      target,
    ]);
  });

  if (!candidates.length) {
    xGuides.forEach((x) => {
      yGuides.forEach((y) => {
        addCandidate([
          source,
          sourceStub,
          { x, y: sourceStub.y },
          { x, y },
          { x: targetStub.x, y },
          targetStub,
          target,
        ]);
      });
    });
  }

  candidates.sort((left, right) => {
    const scoreDifference =
      getOrthogonalRouteScore(left) - getOrthogonalRouteScore(right);
    if (scoreDifference) return scoreDifference;
    return left
      .map((point) => `${point.x},${point.y}`)
      .join('|')
      .localeCompare(right.map((point) => `${point.x},${point.y}`).join('|'));
  });
  return (
    candidates[0] ??
    getOrthogonalTimelinePoints(source, target, sourceSide, targetSide)
  );
}

function offsetRoutePoint(
  point: OutlineRoutePoint,
  side: OutlineEdgePort['side'],
  distance: number,
) {
  if (side === 'north') return { x: point.x, y: point.y - distance };
  if (side === 'south') return { x: point.x, y: point.y + distance };
  if (side === 'west') return { x: point.x - distance, y: point.y };
  return { x: point.x + distance, y: point.y };
}

function simplifyOrthogonalRoute(points: OutlineRoutePoint[]) {
  const simplified = dedupeRoutePoints(points);
  let index = 1;
  while (index < simplified.length - 1) {
    const previous = simplified[index - 1];
    const current = simplified[index];
    const next = simplified[index + 1];
    if (
      (previous.x === current.x && current.x === next.x) ||
      (previous.y === current.y && current.y === next.y)
    ) {
      simplified.splice(index, 1);
      continue;
    }
    index += 1;
  }
  return simplified;
}

function isOrthogonalRouteClear(
  points: OutlineRoutePoint[],
  obstacles: TimelineRouteObstacle[],
) {
  return points.slice(1).every((end, index) => {
    const start = points[index];
    if (start.x !== end.x && start.y !== end.y) return false;
    return obstacles.every(
      (obstacle) => !segmentIntersectsObstacle(start, end, obstacle),
    );
  });
}

function segmentIntersectsObstacle(
  start: OutlineRoutePoint,
  end: OutlineRoutePoint,
  obstacle: TimelineRouteObstacle,
) {
  if (start.y === end.y) {
    return (
      start.y > obstacle.top &&
      start.y < obstacle.bottom &&
      Math.max(Math.min(start.x, end.x), obstacle.left) <
        Math.min(Math.max(start.x, end.x), obstacle.right)
    );
  }
  return (
    start.x > obstacle.left &&
    start.x < obstacle.right &&
    Math.max(Math.min(start.y, end.y), obstacle.top) <
      Math.min(Math.max(start.y, end.y), obstacle.bottom)
  );
}

function getOrthogonalRouteScore(points: OutlineRoutePoint[]) {
  const length = points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return (
      total + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y)
    );
  }, 0);
  return length + Math.max(0, points.length - 2) * 8;
}

function getOrthogonalTimelinePoints(
  source: OutlineRoutePoint,
  target: OutlineRoutePoint,
  sourceSide: OutlineEdgePort['side'],
  targetSide: OutlineEdgePort['side'],
) {
  if (sourceSide === 'east' && targetSide === 'west' && source.y === target.y) {
    return [source, target];
  }

  if (sourceSide === 'west' && targetSide === 'east') {
    const middleX = Math.round((source.x + target.x) / 2);
    return dedupeRoutePoints([
      source,
      { x: middleX, y: source.y },
      { x: middleX, y: target.y },
      target,
    ]);
  }

  if (sourceSide === 'north' || sourceSide === 'south') {
    return dedupeRoutePoints([source, { x: source.x, y: target.y }, target]);
  }

  const middleX = Math.round((source.x + target.x) / 2);
  return dedupeRoutePoints([
    source,
    { x: middleX, y: source.y },
    { x: middleX, y: target.y },
    target,
  ]);
}

function dedupeRoutePoints(points: readonly OutlineRoutePoint[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y;
  });
}

function getRouteMidpoint(points: readonly OutlineRoutePoint[]) {
  if (!points.length) return { x: 0, y: 0 };
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
  return points.at(-1) ?? points[0];
}

function getVerticalTimelinePositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlinePositionMap {
  const laneByNode = getTimelineLanes(nodes, edges);
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: 84 + (laneByNode.get(node.id) ?? 0) * GRID_GAP_X,
        y: 72 + node.order * GRID_GAP_Y,
      },
    ]),
  );
}

function getTimelineLanes(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): Map<string, number> {
  const sequenceEdges = edges.filter((edge) => edge.kind === 'sequence');
  const mainlineIds = new Set(
    nodes.filter((node) => node.type === 'chapter').map((node) => node.id),
  );

  sequenceEdges.forEach((edge) => {
    mainlineIds.add(edge.source);
    mainlineIds.add(edge.target);
  });

  if (!sequenceEdges.length) {
    nodes
      .filter((node) => node.type !== 'character')
      .forEach((node) => mainlineIds.add(node.id));
  }

  const secondaryLanes = getLanes(
    nodes.filter((node) => !mainlineIds.has(node.id)),
  );
  return new Map(
    nodes.map((node) => [
      node.id,
      mainlineIds.has(node.id)
        ? 0
        : 1 + secondaryLanes.indexOf(node.lane ?? '人物'),
    ]),
  );
}

function getFishbonePositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlinePositionMap {
  const mainlineNodes = nodes
    .filter((node) => node.type === 'event' || node.type === 'chapter')
    .sort(compareByOrder);
  const branchNodes = nodes
    .filter(
      (node) => !mainlineNodes.some((mainline) => mainline.id === node.id),
    )
    .sort(compareByOrder);
  const positions: OutlinePositionMap = {};

  mainlineNodes.forEach((node, index) => {
    positions[node.id] = {
      x: 96 + index * GRID_GAP_X,
      y: FISHBONE_MAINLINE_Y,
    };
  });

  const mainlineIds = new Set(mainlineNodes.map((node) => node.id));
  const sideCounts = { top: 0, bottom: 0 };
  branchNodes.forEach((node, index) => {
    const connectedMainlineX = edges
      .flatMap((edge) => {
        if (edge.source === node.id && mainlineIds.has(edge.target)) {
          const x = positions[edge.target]?.x;
          return typeof x === 'number' ? [x] : [];
        }
        if (edge.target === node.id && mainlineIds.has(edge.source)) {
          const x = positions[edge.source]?.x;
          return typeof x === 'number' ? [x] : [];
        }
        return [];
      })
      .filter((x): x is number => typeof x === 'number');
    const fallbackX = 96 + Math.floor(index / 2) * GRID_GAP_X;
    const anchorX = connectedMainlineX.length
      ? connectedMainlineX.reduce((sum, x) => sum + x, 0) /
        connectedMainlineX.length
      : fallbackX;
    const side = index % 2 === 0 ? 'top' : 'bottom';
    const sideIndex = sideCounts[side]++;
    const sideOffset = side === 'top' ? -42 : 42;
    positions[node.id] = {
      x: Math.max(64, anchorX + sideOffset + (sideIndex % 2) * 30),
      y: side === 'top' ? 76 + sideIndex * 24 : 500 - sideIndex * 24,
    };
  });

  return positions;
}

function getLogicPositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlinePositionMap {
  const structuralEdges = getLogicStructuralEdges(nodes, edges);
  const depth = getGraphDepths(nodes, structuralEdges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const layers = new Map<number, OutlineNode[]>();
  const mainlineIds = new Set(
    nodes.filter((node) => node.type === 'chapter').map((node) => node.id),
  );

  edges
    .filter((edge) => edge.kind === 'sequence')
    .forEach((edge) => {
      mainlineIds.add(edge.source);
      mainlineIds.add(edge.target);
    });

  nodes.forEach((node) => {
    const layer = layers.get(depth[node.id] ?? 0) ?? [];
    layer.push(node);
    layers.set(depth[node.id] ?? 0, layer);
  });

  const positions: OutlinePositionMap = {};
  [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([layerIndex, layer]) => {
      const primaryNodes = layer
        .filter((node) => mainlineIds.has(node.id))
        .sort(compareByOrder);
      const branchNodes = layer
        .filter((node) => !mainlineIds.has(node.id))
        .sort(compareByOrder);
      const x = 80 + layerIndex * LOGIC_LAYER_GAP_X;
      const primaryOffset = ((primaryNodes.length - 1) * GRID_GAP_Y) / 2;
      const occupiedY = primaryNodes.map((node, index) => {
        const y = LOGIC_MAINLINE_Y - primaryOffset + index * GRID_GAP_Y;
        positions[node.id] = { x, y };
        return y;
      });

      branchNodes.forEach((node, index) => {
        const parentY = node.parentId
          ? (positions[node.parentId]?.y ?? LOGIC_MAINLINE_Y)
          : LOGIC_MAINLINE_Y;
        const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
        const preferredDirection = parent
          ? parent.type === 'conflict'
            ? 1
            : -1
          : index % 2 === 0
            ? -1
            : 1;
        let y = parentY + preferredDirection * LOGIC_BRANCH_GAP_Y;
        let distance = 1;
        while (
          occupiedY.some(
            (occupied) => Math.abs(occupied - y) < OUTLINE_NODE_HEIGHT + 24,
          )
        ) {
          const direction =
            distance % 2 === 0 ? preferredDirection : -preferredDirection;
          y =
            parentY + direction * LOGIC_BRANCH_GAP_Y * Math.ceil(distance / 2);
          distance += 1;
        }
        positions[node.id] = { x, y };
        occupiedY.push(y);
      });
    });

  return positions;
}

function getLogicStructuralEdges(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlineEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const structuralEdges: OutlineEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, id: string) => {
    if (
      source === target ||
      !nodeIds.has(source) ||
      !nodeIds.has(target) ||
      seen.has(`${source}->${target}`)
    ) {
      return;
    }
    seen.add(`${source}->${target}`);
    structuralEdges.push({ id, source, target, kind: 'sequence' });
  };

  edges
    .filter((edge) => edge.kind === 'sequence')
    .forEach((edge) =>
      addEdge(edge.source, edge.target, `sequence-${edge.id}`),
    );
  nodes.forEach((node) => {
    if (node.parentId) {
      addEdge(node.parentId, node.id, `parent-${node.parentId}-${node.id}`);
    }
  });

  return structuralEdges;
}

function getMindmapPositions(nodes: OutlineNode[]): OutlinePositionMap {
  const root =
    nodes.find((node) => node.id === 'outline-core') ??
    [...nodes].sort(compareByOrder)[0];
  if (!root) return {};

  const children = new Map<string, OutlineNode[]>();
  nodes.forEach((node) => {
    if (!node.parentId) return;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  });
  children.forEach((siblings) => siblings.sort(compareByOrder));

  const positions: OutlinePositionMap = {
    [root.id]: {
      x: MINDMAP_CENTER.x - OUTLINE_NODE_WIDTH / 2,
      y: MINDMAP_CENTER.y - OUTLINE_NODE_HEIGHT / 2,
    },
  };

  const subtreeSizes = new Map<string, number>();
  const measureSubtree = (nodeId: string, path = new Set<string>()): number => {
    if (subtreeSizes.has(nodeId)) return subtreeSizes.get(nodeId) ?? 1;
    if (path.has(nodeId)) return 1;
    const nextPath = new Set(path).add(nodeId);
    const size =
      1 +
      (children.get(nodeId) ?? []).reduce(
        (total, child) => total + measureSubtree(child.id, nextPath),
        0,
      );
    subtreeSizes.set(nodeId, size);
    return size;
  };
  measureSubtree(root.id);

  const placeSubtree = (
    parent: OutlineNode,
    startAngle: number,
    endAngle: number,
    depth: number,
  ) => {
    const siblings = children.get(parent.id) ?? [];
    const totalSize = siblings.reduce(
      (total, node) => total + (subtreeSizes.get(node.id) ?? 1),
      0,
    );
    let cursor = startAngle;
    siblings.forEach((node) => {
      const share =
        ((endAngle - startAngle) * (subtreeSizes.get(node.id) ?? 1)) /
        Math.max(totalSize, 1);
      const angle = cursor + share / 2;
      const radius = 320 + (depth - 1) * 240;
      positions[node.id] = {
        x: MINDMAP_CENTER.x + Math.cos(angle) * radius - OUTLINE_NODE_WIDTH / 2,
        y:
          MINDMAP_CENTER.y + Math.sin(angle) * radius - OUTLINE_NODE_HEIGHT / 2,
      };
      placeSubtree(node, cursor, cursor + share, depth + 1);
      cursor += share;
    });
  };

  placeSubtree(root, -Math.PI * 0.88, Math.PI * 0.88, 1);

  const unplaced = nodes
    .filter((node) => !positions[node.id])
    .sort(compareByOrder);
  unplaced.forEach((node, index) => {
    positions[node.id] = {
      x: 80 + (index % 3) * GRID_GAP_X,
      y: 620 + Math.floor(index / 3) * GRID_GAP_Y,
    };
  });

  return positions;
}

function getGraphDepths(nodes: OutlineNode[], edges: OutlineEdge[]) {
  const incoming = new Map<string, string[]>();
  nodes.forEach((node) => incoming.set(node.id, []));
  edges.forEach((edge) => {
    const sources = incoming.get(edge.target);
    if (sources) sources.push(edge.source);
  });

  const depths: Record<string, number> = {};
  const visit = (nodeId: string, path: Set<string>): number => {
    if (depths[nodeId] !== undefined) return depths[nodeId];
    if (path.has(nodeId)) return 0;
    const nextPath = new Set(path).add(nodeId);
    const parents = incoming.get(nodeId) ?? [];
    const value = parents.length
      ? Math.max(...parents.map((parentId) => visit(parentId, nextPath))) + 1
      : 0;
    depths[nodeId] = value;
    return value;
  };

  nodes.forEach((node) => visit(node.id, new Set()));
  return depths;
}

function getLanes(nodes: OutlineNode[]) {
  return [...new Set(nodes.map((node) => node.lane ?? '主线'))];
}

function compareByOrder(left: OutlineNode, right: OutlineNode) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

export function insertOutlineNode(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  draft: Omit<OutlineNode, 'id' | 'order'> & { id?: string },
  selectedId?: string | null,
): OutlineDocument {
  const selected = selectedId
    ? nodes.find((node) => node.id === selectedId)
    : undefined;
  const order = selected
    ? selected.order + 0.5
    : Math.max(-1, ...nodes.map((node) => node.order)) + 1;
  const requestedId = draft.id ?? `outline-node-${nodes.length + 1}`;
  const id = getUniqueOutlineNodeId(requestedId, nodes);
  const nextNode: OutlineNode = {
    ...draft,
    id,
    order,
    parentId: draft.parentId ?? selected?.id,
  };
  const nextEdge = selected
    ? {
        id: `edge-${selected.id}-${id}`,
        source: selected.id,
        target: id,
        label: '推进',
        kind: 'sequence' as const,
      }
    : null;

  return {
    nodes: [...nodes, nextNode].sort(compareByOrder),
    edges: nextEdge ? [...edges, nextEdge] : edges,
  };
}

function getUniqueOutlineNodeId(
  requestedId: string,
  nodes: readonly OutlineNode[],
) {
  const ids = new Set(nodes.map((node) => node.id));
  if (!ids.has(requestedId)) return requestedId;
  let suffix = 2;
  while (ids.has(`${requestedId}-${suffix}`)) suffix += 1;
  return `${requestedId}-${suffix}`;
}

export function removeOutlineNode(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  nodeId: string,
): OutlineDocument {
  return {
    nodes: nodes
      .filter((node) => node.id !== nodeId)
      .map((node) =>
        node.parentId === nodeId ? { ...node, parentId: undefined } : node,
      ),
    edges: edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    ),
  };
}

export function updateOutlineNode(
  nodes: OutlineNode[],
  nodeId: string,
  patch: Partial<Omit<OutlineNode, 'id' | 'order'>>,
): OutlineNode[] {
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, ...patch } : node,
  );
}

export function toOutlinePositionMap(
  nodes: PositionedOutlineNode[],
): OutlinePositionMap {
  return Object.fromEntries(
    nodes.map((node) => [node.id, { x: node.x, y: node.y }]),
  );
}

export function clampOutlinePosition(
  position: OutlinePosition,
): OutlinePosition {
  return {
    x: Number.isFinite(position.x) ? position.x : 0,
    y: Number.isFinite(position.y) ? position.y : 0,
  };
}
