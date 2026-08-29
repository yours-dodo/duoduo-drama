import type { OutlineDocument } from './story-outline-layout';
import {
  NARRATIVE_CANVAS_ASSET_LABELS,
  type NarrativeCanvasAssetType,
} from './story-narrative-types';
import type {
  OutlineEdgePort,
  OutlineEdgeRoute,
  OutlineLayout,
  OutlinePosition,
  PositionedOutlineNode,
} from './story-outline-types';

export const NARRATIVE_MATERIAL_PREVIEW_NODE_ID =
  '__narrative-material-preview__';
export const NARRATIVE_MATERIAL_PREVIEW_EDGE_ID =
  '__narrative-material-preview-edge__';

export type NarrativeMaterialPreviewRequest = {
  type: NarrativeCanvasAssetType;
  parentId: string;
};

export type NarrativeMaterialPreviewDocument = {
  document: OutlineDocument;
  type: NarrativeCanvasAssetType;
  parentId: string;
  nodeId: typeof NARRATIVE_MATERIAL_PREVIEW_NODE_ID;
  edgeId: typeof NARRATIVE_MATERIAL_PREVIEW_EDGE_ID;
};

export type NarrativeMaterialPreview = NarrativeMaterialPreviewDocument & {
  layout: OutlineLayout;
};

export type ProjectedNarrativeMaterialPreview = {
  node: PositionedOutlineNode;
  route: OutlineEdgeRoute | null;
  sourcePort: OutlineEdgePort | null;
  targetPort: OutlineEdgePort | null;
};

export function createNarrativeMaterialPreviewDocument(
  source: OutlineDocument,
  request: NarrativeMaterialPreviewRequest,
): NarrativeMaterialPreviewDocument | null {
  if (!source.nodes.some((node) => node.id === request.parentId)) return null;

  const label = NARRATIVE_CANVAS_ASSET_LABELS[request.type];
  const order =
    source.nodes.reduce((highest, node) => Math.max(highest, node.order), -1) +
    1;

  return {
    type: request.type,
    parentId: request.parentId,
    nodeId: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
    edgeId: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
    document: {
      nodes: [
        ...source.nodes,
        {
          id: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
          title: `${label}占位`,
          summary: '松手添加',
          type: request.type,
          parentId: request.parentId,
          lane: '剧情资产',
          order,
        },
      ],
      edges: [
        ...source.edges,
        {
          id: NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
          source: request.parentId,
          target: NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
          kind: 'relation',
        },
      ],
    },
  };
}

export function projectNarrativeMaterialPreview(
  currentLayout: OutlineLayout,
  previewLayout: OutlineLayout,
  parentId: string,
): ProjectedNarrativeMaterialPreview | null {
  const currentParent = currentLayout.nodes.find(
    (node) => node.id === parentId,
  );
  const previewParent = previewLayout.nodes.find(
    (node) => node.id === parentId,
  );
  const previewNode = previewLayout.nodes.find(
    (node) => node.id === NARRATIVE_MATERIAL_PREVIEW_NODE_ID,
  );
  if (!currentParent || !previewParent || !previewNode) return null;

  const delta = {
    x: currentParent.x - previewParent.x,
    y: currentParent.y - previewParent.y,
  };
  const route = previewLayout.edgeRoutes?.find(
    (candidate) => candidate.edgeId === NARRATIVE_MATERIAL_PREVIEW_EDGE_ID,
  );
  const sourcePort = route
    ? (previewLayout.edgePorts?.[route.sourcePortId] ?? null)
    : null;
  const targetPort = route
    ? (previewLayout.edgePorts?.[route.targetPortId] ?? null)
    : null;
  const completeRoute = route && sourcePort && targetPort ? route : null;

  return {
    node: {
      ...previewNode,
      x: previewNode.x + delta.x,
      y: previewNode.y + delta.y,
    },
    route: completeRoute ? translateRoute(completeRoute, delta) : null,
    sourcePort: sourcePort ? { ...sourcePort } : null,
    targetPort: targetPort ? { ...targetPort } : null,
  };
}

function translateRoute(route: OutlineEdgeRoute, delta: OutlinePosition) {
  return {
    ...route,
    points: route.points.map((point) => translatePoint(point, delta)),
    subpaths: route.subpaths?.map((path) =>
      path.map((point) => translatePoint(point, delta)),
    ),
    labelPosition: route.labelPosition
      ? translatePoint(route.labelPosition, delta)
      : undefined,
    crossings: route.crossings?.map((crossing) => ({
      ...crossing,
      ...translatePoint(crossing, delta),
    })),
  } satisfies OutlineEdgeRoute;
}

function translatePoint(point: OutlinePosition, delta: OutlinePosition) {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}
