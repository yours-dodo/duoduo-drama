<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import {
  MarkerType,
  Panel,
  Position,
  VueFlow,
  type Edge,
  type Node,
  type NodeDragEvent,
  type NodeMouseEvent,
  type ViewportTransform,
} from '@vue-flow/core';
import { Background, BackgroundVariant } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';

import StoryOutlineFlowNode from './StoryOutlineFlowNode.vue';
import StoryOutlineFlowEdge from './StoryOutlineFlowEdge.vue';
import { findNarrativeMaterialDropTarget } from './story-outline-material-drop';
import {
  projectNarrativeMaterialPreview,
  type NarrativeMaterialPreview,
} from './story-outline-material-preview';
import {
  getSmartSnapPosition,
  type SmartSnapGuide,
  type SmartSnapMatches,
  type SmartSnapNode,
} from './story-outline-snap';
import { shouldFitOutlineViewOnInitialization } from './story-outline-viewport';
import {
  isNarrativeCanvasAssetType,
  NARRATIVE_CANVAS_ASSET_LABELS,
  NARRATIVE_CANVAS_ASSET_TYPES,
  type NarrativeCanvasAssetType,
} from './story-narrative-types';
import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_TYPE_LABELS,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineEdgePort,
  type OutlineEdgeRoute,
  type OutlineLayout,
  type OutlinePortSide,
  type OutlineView,
  type PositionedOutlineNode,
} from './story-outline-types';

type OutlineFlowNodeData = {
  outlineNode: PositionedOutlineNode;
  ports: OutlineEdgePort[];
  isMaterialDropTarget: boolean;
  isMaterialPreview: boolean;
};

type OutlineFlowNode = Node<
  OutlineFlowNodeData,
  Record<string, never>,
  'outline'
>;

export type OutlineFlowEdgeData = {
  route: OutlineEdgeRoute;
};

type NarrativeMaterialDrop = {
  type: NarrativeCanvasAssetType;
  parentId: string;
};

const NARRATIVE_MATERIAL_DRAG_TYPE = 'application/x-duoduo-narrative-material';

const props = defineProps<{
  layout: OutlineLayout;
  edges: readonly OutlineEdge[];
  view: OutlineView;
  selectedId: string | null;
  focusRequest: { nodeId: string; sequence: number } | null;
  materialDropTargetIds: readonly string[];
  materialPreview: NarrativeMaterialPreview | null;
}>();

const emit = defineEmits<{
  select: [nodeId: string];
  clear: [];
  drag: [payload: { nodeId: string; x: number; y: number }];
  relayout: [];
  'add-material': [payload: NarrativeMaterialDrop];
  'preview-material': [payload: NarrativeMaterialDrop | null];
}>();

const materialTools = NARRATIVE_CANVAS_ASSET_TYPES.map((type) => ({
  type,
  label: NARRATIVE_CANVAS_ASSET_LABELS[type],
}));

const flowNodes = ref<OutlineFlowNode[]>(
  toFlowNodes(props.layout, props.edges, props.view, props.selectedId),
);
const flowEdges = ref<Edge[]>(
  toFlowEdges(props.layout, props.edges, props.view),
);
const isClientReady = ref(false);
const vueFlowRef = ref<InstanceType<typeof VueFlow> | null>(null);
const snapEnabled = ref(true);
const draggingMaterialType = ref<NarrativeCanvasAssetType | null>(null);
const materialDropTargetId = ref<string | null>(null);
const snapGrid: [number, number] = [24, 24];
const alignmentGuides = ref<SmartSnapGuide[]>([]);
const activeSnapMatches = ref<SmartSnapMatches>({});
const lastInitializedFitView = ref<OutlineView | null>(null);
const lastSmartSnapPosition = ref<{
  nodeId: string;
  position: { x: number; y: number };
} | null>(null);
const viewportTransform = ref<ViewportTransform>({ x: 0, y: 0, zoom: 1 });
const fitViewPadding = computed(() =>
  props.view.startsWith('organization') ? 0.08 : 0.18,
);
const fitViewOptions = computed(() =>
  props.view === 'timeline-horizontal'
    ? { padding: 0.08, minZoom: 0.68, maxZoom: 1.05 }
    : { padding: fitViewPadding.value },
);
const materialDropTargetIds = computed(
  () => new Set(props.materialDropTargetIds),
);

const alignmentGuideStyles = computed(() =>
  alignmentGuides.value.map((guide, index) => {
    const { x, y, zoom } = viewportTransform.value;
    const position = guide.position * zoom;
    const start = guide.start * zoom;
    const length = (guide.end - guide.start) * zoom;

    return {
      key: `${guide.orientation}-${guide.position}-${index}`,
      className:
        guide.orientation === 'vertical' ? 'is-vertical' : 'is-horizontal',
      style:
        guide.orientation === 'vertical'
          ? {
              left: `${position + x}px`,
              top: `${start + y}px`,
              height: `${length}px`,
            }
          : {
              left: `${start + x}px`,
              top: `${position + y}px`,
              width: `${length}px`,
            },
    };
  }),
);

onMounted(() => {
  isClientReady.value = true;
  viewportTransform.value =
    vueFlowRef.value?.getViewport() ?? viewportTransform.value;
});

function toFlowNodes(
  layout: OutlineLayout,
  edges: readonly OutlineEdge[],
  view: OutlineView,
  selectedId: string | null,
): OutlineFlowNode[] {
  const nodes = layout.nodes;
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const nodeEdges = layout.edgeRoutes?.length ? layout.edgeRoutes : edges;
  const edgePorts = Object.values(layout.edgePorts ?? {});

  return nodes.map((node) => ({
    id: node.id,
    type: 'outline',
    position: { x: node.x, y: node.y },
    data: {
      outlineNode: node,
      ports: edgePorts.filter((port) => port.nodeId === node.id),
      isMaterialDropTarget: false,
      isMaterialPreview: false,
    },
    selected: selectedId === node.id,
    draggable: true,
    selectable: true,
    connectable: false,
    focusable: true,
    deletable: false,
    ariaLabel: `${node.title}，${OUTLINE_NODE_TYPE_LABELS[node.type]}`,
    width: OUTLINE_NODE_WIDTH,
    height: OUTLINE_NODE_HEIGHT,
    targetPosition: getHandlePosition(
      node,
      nodeEdges
        .filter((edge) => edge.target === node.id)
        .map((edge) => positions.get(edge.source))
        .filter((candidate): candidate is PositionedOutlineNode =>
          Boolean(candidate),
        ),
      view,
      'target',
    ),
    sourcePosition: getHandlePosition(
      node,
      nodeEdges
        .filter((edge) => edge.source === node.id)
        .map((edge) => positions.get(edge.target))
        .filter((candidate): candidate is PositionedOutlineNode =>
          Boolean(candidate),
        ),
      view,
      'source',
    ),
  }));
}

function getHandlePosition(
  node: PositionedOutlineNode,
  neighbors: readonly PositionedOutlineNode[],
  view: OutlineView,
  kind: 'source' | 'target',
): Position {
  if (view === 'timeline-vertical') {
    return kind === 'source' ? Position.Bottom : Position.Top;
  }
  if (view === 'timeline-horizontal') {
    return kind === 'source' ? Position.Right : Position.Left;
  }
  if (!neighbors.length) {
    return kind === 'source' ? Position.Right : Position.Left;
  }

  const nodeCenterX = node.x + OUTLINE_NODE_WIDTH / 2;
  const nodeCenterY = node.y + OUTLINE_NODE_HEIGHT / 2;
  const delta = neighbors.reduce(
    (result, neighbor) => ({
      x: result.x + neighbor.x + OUTLINE_NODE_WIDTH / 2 - nodeCenterX,
      y: result.y + neighbor.y + OUTLINE_NODE_HEIGHT / 2 - nodeCenterY,
    }),
    { x: 0, y: 0 },
  );

  if (Math.abs(delta.x) >= Math.abs(delta.y)) {
    return delta.x >= 0 ? Position.Right : Position.Left;
  }
  return delta.y >= 0 ? Position.Bottom : Position.Top;
}

function toFlowEdges(
  layout: OutlineLayout,
  edges: readonly OutlineEdge[],
  view: OutlineView,
): Edge[] {
  const nodes = layout.nodes;
  const isRoutedView =
    view === 'timeline-horizontal' ||
    view === 'organization-logic' ||
    view === 'organization-mindmap';
  if (isRoutedView && layout.edgeRoutes?.length) {
    return (layout.edgeRoutes ?? []).map((route, index) => ({
      id: route.edgeId,
      source: route.source,
      target: route.target,
      sourceHandle: route.sourcePortId,
      targetHandle: route.targetPortId,
      type: 'outline',
      data: { route } satisfies OutlineFlowEdgeData,
      class: [
        `is-${view}`,
        `is-edge-kind-${route.kind ?? 'sequence'}`,
        route.decorativeRole === 'axis' ? 'is-timeline-axis' : '',
        route.decorativeRole === 'branch' ? 'is-timeline-branch' : '',
        route.hidden ? 'is-edge-hidden' : '',
        `is-edge-variant-${index % 3}`,
      ].join(' '),
      label: route.label,
      ...(route.decorative
        ? {}
        : {
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 14,
              height: 14,
            },
          }),
      selectable: false,
      focusable: false,
      deletable: false,
    }));
  }

  const positions = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge, index) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const deltaX = (target?.x ?? 0) - (source?.x ?? 0);
    const deltaY = (target?.y ?? 0) - (source?.y ?? 0);
    const curvature = getEdgeCurvature(view, deltaX, deltaY, index);
    const edgeType = 'default';

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edgeType,
      ...(edgeType === 'default' ? { pathOptions: { curvature } } : {}),
      class: [
        `is-${view}`,
        `is-edge-kind-${edge.kind ?? 'sequence'}`,
        `is-edge-variant-${index % 3}`,
      ].join(' '),
      label: edge.label,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
      },
      selectable: false,
      focusable: false,
      deletable: false,
      labelStyle: {
        fill: 'var(--story-entry-muted)',
        fontFamily: 'IBM Plex Mono, SFMono-Regular, monospace',
        fontSize: '10px',
      },
      labelBgStyle: {
        fill: 'var(--story-entry-paper)',
        fillOpacity: 0.92,
        stroke: 'none',
      },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4,
    };
  });
}

function toFlowElements(
  layout: OutlineLayout,
  edges: readonly OutlineEdge[],
  view: OutlineView,
  selectedId: string | null,
  preview: NarrativeMaterialPreview | null,
) {
  let nodes = toFlowNodes(layout, edges, view, selectedId);
  const flowEdges = toFlowEdges(layout, edges, view);
  if (!preview) return { nodes, edges: flowEdges };

  const projection = projectNarrativeMaterialPreview(
    layout,
    preview.layout,
    preview.parentId,
  );
  if (!projection) return { nodes, edges: flowEdges };

  const fallbackSides = getPreviewPortSides(
    layout.nodes.find((node) => node.id === preview.parentId),
    projection.node,
  );
  const sourcePort =
    projection.route && projection.sourcePort
      ? projection.sourcePort
      : createPreviewPort(
          `${preview.edgeId}-source`,
          preview.edgeId,
          preview.parentId,
          'source',
          fallbackSides.source,
        );
  const targetPort =
    projection.route && projection.targetPort
      ? projection.targetPort
      : createPreviewPort(
          `${preview.edgeId}-target`,
          preview.edgeId,
          preview.nodeId,
          'target',
          fallbackSides.target,
        );

  nodes = nodes.map((node) =>
    node.id === preview.parentId
      ? {
          ...node,
          data: {
            ...node.data,
            ports: appendPort(node.data.ports, sourcePort),
          },
        }
      : node,
  );
  nodes.push({
    id: preview.nodeId,
    type: 'outline',
    position: { x: projection.node.x, y: projection.node.y },
    data: {
      outlineNode: projection.node,
      ports: [targetPort],
      isMaterialDropTarget: false,
      isMaterialPreview: true,
    },
    selected: false,
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    deletable: false,
    ariaLabel: `${NARRATIVE_CANVAS_ASSET_LABELS[preview.type]}放置预览`,
    class: `is-material-preview is-preview-${preview.type}`,
    width: OUTLINE_NODE_WIDTH,
    height: OUTLINE_NODE_HEIGHT,
  });
  flowEdges.push(
    projection.route
      ? {
          id: preview.edgeId,
          source: preview.parentId,
          target: preview.nodeId,
          sourceHandle: sourcePort.id,
          targetHandle: targetPort.id,
          type: 'outline',
          data: { route: projection.route } satisfies OutlineFlowEdgeData,
          class: `is-material-preview is-preview-${preview.type}`,
          selectable: false,
          focusable: false,
          deletable: false,
        }
      : {
          id: preview.edgeId,
          source: preview.parentId,
          target: preview.nodeId,
          sourceHandle: sourcePort.id,
          targetHandle: targetPort.id,
          type: 'smoothstep',
          pathOptions: { borderRadius: 16, offset: 24 },
          class: `is-material-preview is-preview-${preview.type}`,
          selectable: false,
          focusable: false,
          deletable: false,
        },
  );

  return { nodes, edges: flowEdges };
}

function createPreviewPort(
  id: string,
  edgeId: string,
  nodeId: string,
  kind: OutlineEdgePort['kind'],
  side: OutlinePortSide,
): OutlineEdgePort {
  return { id, edgeId, nodeId, kind, side, offset: 0.5 };
}

function appendPort(ports: readonly OutlineEdgePort[], port: OutlineEdgePort) {
  return [...ports.filter((candidate) => candidate.id !== port.id), port];
}

function getPreviewPortSides(
  parent: PositionedOutlineNode | undefined,
  preview: PositionedOutlineNode,
): { source: OutlinePortSide; target: OutlinePortSide } {
  if (!parent) return { source: 'east', target: 'west' };

  const deltaX = preview.x - parent.x;
  const deltaY = preview.y - parent.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { source: 'east', target: 'west' }
      : { source: 'west', target: 'east' };
  }
  return deltaY >= 0
    ? { source: 'south', target: 'north' }
    : { source: 'north', target: 'south' };
}

function getEdgeCurvature(
  view: OutlineView,
  deltaX: number,
  deltaY: number,
  index: number,
) {
  const distance = Math.min(1, Math.hypot(deltaX, deltaY) / 720);
  const rhythm = [0.22, 0.28, 0.34][index % 3];

  if (view === 'timeline-fishbone') return Math.min(0.46, rhythm + 0.08);
  if (view === 'organization-mindmap')
    return Math.min(0.5, rhythm + distance * 0.12);
  if (view === 'organization-logic')
    return Math.min(0.44, rhythm + distance * 0.08);
  return Math.min(0.4, rhythm + Math.min(0.08, Math.abs(deltaY) / 720));
}

watch(
  () => [props.layout, props.edges, props.view, props.materialPreview] as const,
  ([layout, edges, view, preview]) => {
    const elements = toFlowElements(
      layout,
      edges,
      view,
      props.selectedId,
      preview,
    );
    flowNodes.value = elements.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isMaterialDropTarget:
          !node.data.isMaterialPreview &&
          node.id === materialDropTargetId.value,
      },
    }));
    flowEdges.value = elements.edges;
  },
  { immediate: true },
);

watch(
  () => props.view,
  (view) => {
    setMaterialDropTarget(null);
    lastInitializedFitView.value = view;
    if (isClientReady.value) {
      void nextTick().then(() => {
        if (props.view !== view) return;
        return vueFlowRef.value?.fitView(fitViewOptions.value);
      });
    }
  },
);

onBeforeUnmount(() => {
  emit('preview-material', null);
});

watch(
  () => props.selectedId,
  (selectedId) => {
    flowNodes.value = flowNodes.value.map((node) => ({
      ...node,
      selected: node.id === selectedId,
    }));
  },
);

watch(
  () => props.focusRequest?.sequence,
  () => {
    if (props.focusRequest) void focusNode(props.focusRequest.nodeId);
  },
);

async function focusNode(nodeId: string) {
  if (!isClientReady.value) return;

  await nextTick();
  const node = flowNodes.value.find((candidate) => candidate.id === nodeId);
  if (!node) return;

  const zoom = Math.min(1.05, Math.max(0.9, viewportTransform.value.zoom));
  await vueFlowRef.value?.setCenter(
    node.position.x + OUTLINE_NODE_WIDTH / 2,
    node.position.y + OUTLINE_NODE_HEIGHT / 2,
    {
      zoom,
      duration: 260,
      interpolate: 'smooth',
    },
  );
}

function handleNodeClick(event: NodeMouseEvent) {
  emit('select', event.node.id);
}

function handleMaterialDragStart(
  event: DragEvent,
  type: NarrativeCanvasAssetType,
) {
  if (!event.dataTransfer) return;

  draggingMaterialType.value = type;
  setMaterialDropTarget(null);
  event.dataTransfer.effectAllowed = 'copy';
  event.dataTransfer.setData(NARRATIVE_MATERIAL_DRAG_TYPE, type);
  event.dataTransfer.setData('text/plain', `narrative-material:${type}`);
}

function handleMaterialDragEnd() {
  draggingMaterialType.value = null;
  setMaterialDropTarget(null);
}

function handleMaterialDragOver(event: DragEvent) {
  if (!draggingMaterialType.value) return;

  event.preventDefault();
  const target = findMaterialDropTarget(event.clientX, event.clientY);
  setMaterialDropTarget(target?.id ?? null);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = target ? 'copy' : 'none';
  }
}

function handleMaterialDrop(event: DragEvent) {
  const type = getDraggedMaterialType(event);
  if (!type) return;

  event.preventDefault();
  const target = findMaterialDropTarget(event.clientX, event.clientY);
  draggingMaterialType.value = null;
  setMaterialDropTarget(null);
  if (!target) return;

  emit('add-material', { type, parentId: target.id });
}

function findMaterialDropTarget(clientX: number, clientY: number) {
  const flowPosition = vueFlowRef.value?.screenToFlowCoordinate({
    x: clientX,
    y: clientY,
  });
  if (!flowPosition) return null;

  return findNarrativeMaterialDropTarget(
    props.layout.nodes,
    materialDropTargetIds.value,
    flowPosition,
  );
}

function setMaterialDropTarget(nodeId: string | null) {
  if (materialDropTargetId.value === nodeId) return;
  materialDropTargetId.value = nodeId;
  flowNodes.value = flowNodes.value.map((node) => ({
    ...node,
    data: {
      ...node.data,
      isMaterialDropTarget: node.id === nodeId,
    },
  }));
  emit(
    'preview-material',
    nodeId && draggingMaterialType.value
      ? { type: draggingMaterialType.value, parentId: nodeId }
      : null,
  );
}

function getDraggedMaterialType(event: DragEvent) {
  const customType = event.dataTransfer?.getData(NARRATIVE_MATERIAL_DRAG_TYPE);
  if (isNarrativeCanvasAssetType(customType)) return customType;

  const textType = event.dataTransfer
    ?.getData('text/plain')
    .replace(/^narrative-material:/, '');
  if (isNarrativeCanvasAssetType(textType)) return textType;
  return draggingMaterialType.value;
}

function toSmartSnapNode(
  nodeId: string,
  position: { x: number; y: number },
): SmartSnapNode {
  return {
    id: nodeId,
    x: position.x,
    y: position.y,
    width: OUTLINE_NODE_WIDTH,
    height: OUTLINE_NODE_HEIGHT,
  };
}

function getSmartSnapResult(
  nodeId: string,
  position: { x: number; y: number },
  matches = activeSnapMatches.value,
) {
  const movingNode = toSmartSnapNode(nodeId, position);
  const otherNodes = props.layout.nodes.map((node) =>
    toSmartSnapNode(node.id, { x: node.x, y: node.y }),
  );
  const zoom = Math.max(viewportTransform.value.zoom, 0.25);

  return getSmartSnapPosition(movingNode, otherNodes, matches, {
    threshold: 8 / zoom,
    releaseThreshold: 12 / zoom,
  });
}

function handleNodeDragStart() {
  activeSnapMatches.value = {};
  alignmentGuides.value = [];
  lastSmartSnapPosition.value = null;
}

function handleNodeDrag(event: NodeDragEvent) {
  if (!snapEnabled.value) {
    alignmentGuides.value = [];
    activeSnapMatches.value = {};
    lastSmartSnapPosition.value = null;
    return;
  }

  const result = getSmartSnapResult(event.node.id, event.node.position);
  activeSnapMatches.value = result.matches;
  alignmentGuides.value = result.guides;
  lastSmartSnapPosition.value = {
    nodeId: event.node.id,
    position: result.position,
  };
  vueFlowRef.value?.updateNode(event.node.id, {
    position: result.position,
  });
}

function handleNodeDragStop(event: NodeDragEvent) {
  const result = snapEnabled.value
    ? getSmartSnapResult(event.node.id, event.node.position)
    : null;
  const position =
    result?.position ??
    (lastSmartSnapPosition.value?.nodeId === event.node.id
      ? lastSmartSnapPosition.value.position
      : event.node.position);

  if (result) {
    vueFlowRef.value?.updateNode(event.node.id, { position });
  }
  emit('drag', {
    nodeId: event.node.id,
    x: position.x,
    y: position.y,
  });
  alignmentGuides.value = [];
  activeSnapMatches.value = {};
  lastSmartSnapPosition.value = null;
}

async function handleNodesInitialized() {
  const view = props.view;
  if (
    !shouldFitOutlineViewOnInitialization(lastInitializedFitView.value, view)
  ) {
    return;
  }
  lastInitializedFitView.value = view;
  await nextTick();
  if (props.view !== view) return;
  await vueFlowRef.value?.fitView(fitViewOptions.value);
}

async function handleRelayout() {
  emit('relayout');
  await nextTick();
  await vueFlowRef.value?.fitView(fitViewOptions.value);
}

function handleViewportChange(viewport: ViewportTransform) {
  viewportTransform.value = viewport;
}
</script>

<template>
  <div class="story-outline-canvas-scroll">
    <VueFlow
      ref="vueFlowRef"
      :nodes="isClientReady ? flowNodes : []"
      :edges="isClientReady ? flowEdges : []"
      :key="view"
      class="story-outline-vue-flow"
      :class="[`is-${view}`, { 'is-material-dragging': draggingMaterialType }]"
      :nodes-connectable="false"
      :nodes-draggable="true"
      :elements-selectable="true"
      :select-nodes-on-drag="false"
      :delete-key-code="null"
      :snap-to-grid="false"
      :zoom-on-scroll="false"
      :zoom-on-pinch="true"
      :zoom-on-double-click="false"
      :pan-on-scroll="true"
      :pan-on-drag="true"
      :fit-view-on-init="true"
      :fit-view-options="fitViewOptions"
      :min-zoom="0.25"
      :max-zoom="1.8"
      @node-click="handleNodeClick"
      @node-drag-start="handleNodeDragStart"
      @node-drag="handleNodeDrag"
      @node-drag-stop="handleNodeDragStop"
      @nodes-initialized="handleNodesInitialized"
      @viewport-change="handleViewportChange"
      @pane-click="emit('clear')"
      @dragover="handleMaterialDragOver"
      @drop="handleMaterialDrop"
    >
      <Background
        :variant="BackgroundVariant.Lines"
        :gap="snapGrid"
        :size="1"
        color="var(--story-entry-line)"
        :line-width="0.7"
      />

      <Controls
        position="bottom-right"
        role="toolbar"
        aria-label="画布工具栏"
        :show-zoom="true"
        :show-fit-view="true"
        :show-interactive="true"
        :fit-view-params="fitViewOptions"
      >
        <template #control-interactive>
          <button
            type="button"
            class="vue-flow__controls-button vue-flow__controls-interactive"
            aria-label="重布局"
            title="重布局"
            @click.stop="handleRelayout"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M17.65 6.35A7.94 7.94 0 0 0 12 4a8 8 0 0 0-7.75 6H2.18A10 10 0 0 1 12 2c2.76 0 5.26 1.12 7.07 2.93L22 2v8h-8l3.65-3.65ZM6.35 17.65A7.94 7.94 0 0 0 12 20a8 8 0 0 0 7.75-6h2.07A10 10 0 0 1 12 22a9.97 9.97 0 0 1-7.07-2.93L2 22v-8h8l-3.65 3.65Z"
              />
            </svg>
          </button>
        </template>
      </Controls>

      <Panel
        position="bottom-center"
        class="story-outline-material-toolbar"
        :class="{ 'is-dragging': draggingMaterialType }"
        role="toolbar"
        aria-label="剧情物料工具栏"
      >
        <div class="story-outline-material-toolbar-heading">
          <span class="story-outline-material-grip" aria-hidden="true">
            <i v-for="dot in 6" :key="dot" />
          </span>
          <span class="story-outline-material-toolbar-copy">
            <strong>剧情物料</strong>
            <small>拖到节点</small>
          </span>
        </div>
        <div class="story-outline-material-toolbar-items">
          <button
            v-for="tool in materialTools"
            :key="tool.type"
            type="button"
            class="story-outline-material-button"
            :class="[
              `is-${tool.type}`,
              { 'is-dragging': draggingMaterialType === tool.type },
            ]"
            draggable="true"
            :aria-label="`拖动${tool.label}到叙事节点`"
            :title="`拖动${tool.label}到叙事节点`"
            @dragstart.stop="handleMaterialDragStart($event, tool.type)"
            @dragend="handleMaterialDragEnd"
          >
            <span class="story-outline-material-icon" aria-hidden="true">
              <svg v-if="tool.type === 'event'" viewBox="0 0 24 24" fill="none">
                <path d="m12 3 9 9-9 9-9-9 9-9Z" />
                <path d="M8.5 12h7" />
              </svg>
              <svg
                v-else-if="tool.type === 'foreshadow'"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path d="M12 20V10" />
                <path d="M12 13c-4.2 0-6-2.2-6-6 4.2 0 6 2.2 6 6Z" />
                <path d="M12 10c0-3.8 2-5.7 6-5.7 0 3.8-2 5.7-6 5.7Z" />
              </svg>
              <svg
                v-else-if="tool.type === 'mystery'"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle cx="12" cy="12" r="9" />
                <path
                  d="M9.7 9a2.45 2.45 0 1 1 3.58 2.18c-.8.42-1.28.94-1.28 1.82"
                />
                <path d="M12 17h.01" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none">
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="8" r="2" />
                <circle cx="18" cy="18" r="2" />
                <path d="M8 6h2a4 4 0 0 1 4 4v4a4 4 0 0 0 4 4" />
                <path d="M14 11a3 3 0 0 1 3-3h1" />
              </svg>
            </span>
            <span class="story-outline-material-button-label">{{
              tool.label
            }}</span>
          </button>
        </div>
      </Panel>

      <template #node-outline="nodeProps">
        <StoryOutlineFlowNode v-bind="nodeProps" />
      </template>
      <template #edge-outline="edgeProps">
        <StoryOutlineFlowEdge v-bind="edgeProps" />
      </template>
    </VueFlow>
    <div class="story-outline-alignment-guides" aria-hidden="true">
      <span
        v-for="guide in alignmentGuideStyles"
        :key="guide.key"
        class="story-outline-alignment-guide"
        :class="guide.className"
        :style="guide.style"
      />
    </div>
    <div
      v-if="!isClientReady"
      class="story-outline-vue-flow-fallback"
      :style="{ width: `${layout.width}px`, height: `${layout.height}px` }"
      aria-hidden="true"
    >
      <article
        v-for="node in layout.nodes"
        :key="node.id"
        class="story-outline-node story-outline-vue-flow-fallback-node"
        :class="`is-${node.type}`"
        :style="{ left: `${node.x}px`, top: `${node.y}px` }"
      >
        <div class="story-outline-node-meta">
          <span>{{ OUTLINE_NODE_TYPE_LABELS[node.type] }}</span>
          <span v-if="node.lane">{{ node.lane }}</span>
        </div>
        <strong>{{ node.title }}</strong>
        <p>{{ node.summary }}</p>
      </article>
    </div>
  </div>
</template>
