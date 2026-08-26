import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlinePosition,
} from './story-outline-types';

export type SmartSnapAxis = 'x' | 'y';
export type SmartSnapAnchor = 'start' | 'center' | 'end';

export type SmartSnapNode = OutlinePosition & {
  id: string;
  width?: number;
  height?: number;
};

export type SmartSnapMatch = {
  axis: SmartSnapAxis;
  sourceAnchor: SmartSnapAnchor;
  targetAnchor: SmartSnapAnchor;
  targetNodeId: string;
};

export type SmartSnapMatches = {
  x?: SmartSnapMatch;
  y?: SmartSnapMatch;
};

export type SmartSnapGuide = {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
};

export type SmartSnapResult = {
  position: OutlinePosition;
  matches: SmartSnapMatches;
  guides: SmartSnapGuide[];
};

export type SmartSnapOptions = {
  threshold?: number;
  releaseThreshold?: number;
};

const DEFAULT_THRESHOLD = 8;
const DEFAULT_RELEASE_THRESHOLD = 12;

type AxisResolution = {
  coordinate: number;
  match?: SmartSnapMatch;
};

function getSize(node: SmartSnapNode, axis: SmartSnapAxis) {
  return axis === 'x'
    ? (node.width ?? OUTLINE_NODE_WIDTH)
    : (node.height ?? OUTLINE_NODE_HEIGHT);
}

function getAnchorValue(
  node: SmartSnapNode,
  axis: SmartSnapAxis,
  anchor: SmartSnapAnchor,
  position = node,
) {
  const start = axis === 'x' ? position.x : position.y;
  const size = getSize(node, axis);

  if (anchor === 'center') return start + size / 2;
  if (anchor === 'end') return start + size;
  return start;
}

function getAnchors(node: SmartSnapNode, axis: SmartSnapAxis) {
  return (['start', 'center', 'end'] as const).map((anchor) => ({
    anchor,
    value: getAnchorValue(node, axis, anchor),
  }));
}

function resolveAxis(
  movingNode: SmartSnapNode,
  otherNodes: readonly SmartSnapNode[],
  axis: SmartSnapAxis,
  activeMatch: SmartSnapMatch | undefined,
  threshold: number,
  releaseThreshold: number,
): AxisResolution {
  const sourceAnchors = getAnchors(movingNode, axis);
  const candidates = otherNodes.flatMap((targetNode) =>
    getAnchors(targetNode, axis).map((target) => ({
      targetNode,
      targetAnchor: target.anchor,
      targetValue: target.value,
    })),
  );

  if (activeMatch?.axis === axis) {
    const activeTarget = otherNodes.find(
      (node) => node.id === activeMatch.targetNodeId,
    );
    if (activeTarget) {
      const sourceValue = getAnchorValue(
        movingNode,
        axis,
        activeMatch.sourceAnchor,
      );
      const targetValue = getAnchorValue(
        activeTarget,
        axis,
        activeMatch.targetAnchor,
      );
      if (Math.abs(targetValue - sourceValue) <= releaseThreshold) {
        return {
          coordinate:
            (axis === 'x' ? movingNode.x : movingNode.y) +
            targetValue -
            sourceValue,
          match: activeMatch,
        };
      }
    }
  }

  let best:
    | {
        distance: number;
        sourceAnchor: SmartSnapAnchor;
        targetAnchor: SmartSnapAnchor;
        targetNodeId: string;
        targetValue: number;
        sourceValue: number;
      }
    | undefined;

  sourceAnchors.forEach((source) => {
    candidates.forEach((candidate) => {
      const distance = Math.abs(candidate.targetValue - source.value);
      if (distance > threshold || (best && distance >= best.distance)) return;
      best = {
        distance,
        sourceAnchor: source.anchor,
        targetAnchor: candidate.targetAnchor,
        targetNodeId: candidate.targetNode.id,
        targetValue: candidate.targetValue,
        sourceValue: source.value,
      };
    });
  });

  if (!best) {
    return { coordinate: axis === 'x' ? movingNode.x : movingNode.y };
  }

  return {
    coordinate:
      (axis === 'x' ? movingNode.x : movingNode.y) +
      best.targetValue -
      best.sourceValue,
    match: {
      axis,
      sourceAnchor: best.sourceAnchor,
      targetAnchor: best.targetAnchor,
      targetNodeId: best.targetNodeId,
    },
  };
}

function createGuide(
  movingNode: SmartSnapNode,
  targetNode: SmartSnapNode,
  axis: SmartSnapAxis,
  position: number,
): SmartSnapGuide {
  if (axis === 'x') {
    const start = Math.min(movingNode.y, targetNode.y);
    const end = Math.max(
      movingNode.y + getSize(movingNode, 'y'),
      targetNode.y + getSize(targetNode, 'y'),
    );
    return { orientation: 'vertical', position, start, end };
  }

  const start = Math.min(movingNode.x, targetNode.x);
  const end = Math.max(
    movingNode.x + getSize(movingNode, 'x'),
    targetNode.x + getSize(targetNode, 'x'),
  );
  return { orientation: 'horizontal', position, start, end };
}

export function getSmartSnapPosition(
  movingNode: SmartSnapNode,
  otherNodes: readonly SmartSnapNode[],
  activeMatches: SmartSnapMatches = {},
  options: SmartSnapOptions = {},
): SmartSnapResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const releaseThreshold = Math.max(
    threshold,
    options.releaseThreshold ?? DEFAULT_RELEASE_THRESHOLD,
  );
  const candidates = otherNodes.filter((node) => node.id !== movingNode.id);
  const x = resolveAxis(
    movingNode,
    candidates,
    'x',
    activeMatches.x,
    threshold,
    releaseThreshold,
  );
  const y = resolveAxis(
    movingNode,
    candidates,
    'y',
    activeMatches.y,
    threshold,
    releaseThreshold,
  );
  const position = { x: x.coordinate, y: y.coordinate };
  const snappedNode = { ...movingNode, ...position };
  const matches = { x: x.match, y: y.match };
  const guides: SmartSnapGuide[] = [];

  if (x.match) {
    const target = candidates.find((node) => node.id === x.match?.targetNodeId);
    if (target) {
      guides.push(
        createGuide(
          snappedNode,
          target,
          'x',
          getAnchorValue(target, 'x', x.match.targetAnchor),
        ),
      );
    }
  }

  if (y.match) {
    const target = candidates.find((node) => node.id === y.match?.targetNodeId);
    if (target) {
      guides.push(
        createGuide(
          snappedNode,
          target,
          'y',
          getAnchorValue(target, 'y', y.match.targetAnchor),
        ),
      );
    }
  }

  return { position, matches, guides };
}
