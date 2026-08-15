import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineLayout,
  type OutlineMode,
  type OutlineNode,
  type OutlinePosition,
  type OutlinePositionMap,
  type OutlineView,
  type PositionedOutlineNode,
} from './story-outline-types';

export type OutlineDocument = {
  nodes: OutlineNode[];
  edges: OutlineEdge[];
};

const GRID_GAP_X = 300;
const GRID_GAP_Y = 168;

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
      },
      {
        id: 'edge-lin-archive',
        source: 'outline-lin',
        target: 'outline-archive',
        label: '追查',
      },
      {
        id: 'edge-archive-truth',
        source: 'outline-archive',
        target: 'outline-truth',
        label: '揭开',
      },
      {
        id: 'edge-zhou-choice',
        source: 'outline-zhou',
        target: 'outline-choice',
        label: '阻止',
      },
      {
        id: 'edge-truth-choice',
        source: 'outline-truth',
        target: 'outline-choice',
        label: '逼迫',
      },
      {
        id: 'edge-choice-ending',
        source: 'outline-choice',
        target: 'outline-ending',
        label: '结果',
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
  const positionedNodes = nodes.map((node) => {
    const position = overrides[node.id] ?? basePositions[node.id] ?? { x: 80, y: 80 };
    return {
      ...node,
      x: Math.max(40, position.x),
      y: Math.max(40, position.y),
    };
  });

  const maxX = positionedNodes.reduce(
    (value, node) => Math.max(value, node.x + OUTLINE_NODE_WIDTH),
    960,
  );
  const maxY = positionedNodes.reduce(
    (value, node) => Math.max(value, node.y + OUTLINE_NODE_HEIGHT),
    520,
  );

  return {
    width: Math.max(maxX + 120, view === 'timeline-vertical' ? 720 : 1120),
    height: Math.max(maxY + 100, view === 'timeline-horizontal' ? 560 : 680),
    nodes: positionedNodes,
  };
}

function getBasePositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
  view: OutlineView,
): OutlinePositionMap {
  switch (view) {
    case 'timeline-horizontal':
      return getHorizontalTimelinePositions(nodes);
    case 'timeline-vertical':
      return getVerticalTimelinePositions(nodes);
    case 'timeline-fishbone':
      return getFishbonePositions(nodes);
    case 'organization-logic':
      return getLogicPositions(nodes, edges);
    case 'organization-mindmap':
      return getMindmapPositions(nodes);
  }
}

function getHorizontalTimelinePositions(nodes: OutlineNode[]): OutlinePositionMap {
  const lanes = getLanes(nodes);
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: 80 + node.order * GRID_GAP_X,
        y: 72 + lanes.indexOf(node.lane ?? '主线') * GRID_GAP_Y,
      },
    ]),
  );
}

function getVerticalTimelinePositions(nodes: OutlineNode[]): OutlinePositionMap {
  const lanes = getLanes(nodes);
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: 80 + lanes.indexOf(node.lane ?? '主线') * GRID_GAP_X,
        y: 64 + node.order * GRID_GAP_Y,
      },
    ]),
  );
}

function getFishbonePositions(nodes: OutlineNode[]): OutlinePositionMap {
  const mainlineNodes = nodes
    .filter((node) => node.type === 'event' || node.type === 'chapter')
    .sort(compareByOrder);
  const branchNodes = nodes
    .filter((node) => !mainlineNodes.some((mainline) => mainline.id === node.id))
    .sort(compareByOrder);
  const positions: OutlinePositionMap = {};

  mainlineNodes.forEach((node, index) => {
    positions[node.id] = { x: 80 + index * GRID_GAP_X, y: 280 };
  });

  branchNodes.forEach((node, index) => {
    const branchIndex = Math.floor(index / 2);
    positions[node.id] = {
      x: 150 + branchIndex * GRID_GAP_X,
      y: index % 2 === 0 ? 92 : 488,
    };
  });

  return positions;
}

function getLogicPositions(
  nodes: OutlineNode[],
  edges: OutlineEdge[],
): OutlinePositionMap {
  const depth = getGraphDepths(nodes, edges);
  const layers = new Map<number, OutlineNode[]>();

  nodes.forEach((node) => {
    const layer = layers.get(depth[node.id] ?? 0) ?? [];
    layer.push(node);
    layers.set(depth[node.id] ?? 0, layer);
  });

  const positions: OutlinePositionMap = {};
  [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .forEach(([layerIndex, layer]) => {
      layer.sort(compareByOrder).forEach((node, index) => {
        positions[node.id] = {
          x: 80 + layerIndex * GRID_GAP_X,
          y: 72 + index * GRID_GAP_Y,
        };
      });
    });

  return positions;
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
    [root.id]: { x: 540, y: 282 },
  };

  const placeSubtree = (
    parent: OutlineNode,
    startAngle: number,
    endAngle: number,
    depth: number,
  ) => {
    const siblings = children.get(parent.id) ?? [];
    siblings.forEach((node, index) => {
      const ratio = (index + 1) / (siblings.length + 1);
      const angle = startAngle + (endAngle - startAngle) * ratio;
      const radius = depth === 1 ? 340 : 230;
      positions[node.id] = {
        x: 540 + Math.cos(angle) * radius - OUTLINE_NODE_WIDTH / 2,
        y: 338 + Math.sin(angle) * radius - OUTLINE_NODE_HEIGHT / 2,
      };
      placeSubtree(node, angle - 0.45, angle + 0.45, depth + 1);
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
  const id = draft.id ?? `outline-node-${nodes.length + 1}`;
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
      }
    : null;

  return {
    nodes: [...nodes, nextNode].sort(compareByOrder),
    edges: nextEdge ? [...edges, nextEdge] : edges,
  };
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

export function clampOutlinePosition(position: OutlinePosition): OutlinePosition {
  return {
    x: Math.max(24, position.x),
    y: Math.max(24, position.y),
  };
}
