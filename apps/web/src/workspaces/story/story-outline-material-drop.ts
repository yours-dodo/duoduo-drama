import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_WIDTH,
  type OutlinePosition,
  type PositionedOutlineNode,
} from './story-outline-types';

export function findNarrativeMaterialDropTarget(
  nodes: readonly PositionedOutlineNode[],
  structuralNodeIds: ReadonlySet<string>,
  point: OutlinePosition,
): PositionedOutlineNode | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const depthCache = new Map<string, number>();

  const getDepth = (node: PositionedOutlineNode): number => {
    const cached = depthCache.get(node.id);
    if (cached !== undefined) return cached;

    const visited = new Set([node.id]);
    let depth = 0;
    let parentId = node.parentId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = nodesById.get(parentId);
      if (!parent) break;
      depth += 1;
      parentId = parent.parentId;
    }
    depthCache.set(node.id, depth);
    return depth;
  };

  return (
    nodes
      .filter(
        (node) =>
          structuralNodeIds.has(node.id) &&
          point.x >= node.x &&
          point.x <= node.x + OUTLINE_NODE_WIDTH &&
          point.y >= node.y &&
          point.y <= node.y + OUTLINE_NODE_HEIGHT,
      )
      .sort(
        (left, right) =>
          getDepth(right) - getDepth(left) || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}
