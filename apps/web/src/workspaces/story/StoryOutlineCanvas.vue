<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import {
  OUTLINE_NODE_HEIGHT,
  OUTLINE_NODE_TYPE_LABELS,
  OUTLINE_NODE_WIDTH,
  type OutlineEdge,
  type OutlineLayout,
  type OutlineNodeType,
  type OutlineView,
  type PositionedOutlineNode,
} from './story-outline-types';

const props = defineProps<{
  layout: OutlineLayout;
  edges: readonly OutlineEdge[];
  view: OutlineView;
  scale: number;
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [nodeId: string];
  clear: [];
  edit: [nodeId: string];
  drag: [payload: { nodeId: string; x: number; y: number }];
}>();

type DragState = {
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
};

const dragState = ref<DragState | null>(null);

const nodesById = computed(
  () => new Map(props.layout.nodes.map((node) => [node.id, node])),
);

const stageStyle = computed(() => ({
  width: `${props.layout.width * props.scale}px`,
  height: `${props.layout.height * props.scale}px`,
}));

const surfaceStyle = computed(() => ({
  width: `${props.layout.width}px`,
  height: `${props.layout.height}px`,
  transform: `scale(${props.scale})`,
}));

function startDrag(event: PointerEvent, node: PositionedOutlineNode) {
  if (event.button !== 0) return;

  dragState.value = {
    nodeId: node.id,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    originX: node.x,
    originY: node.y,
  };
  emit('select', node.id);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopDrag);
  window.addEventListener('pointercancel', stopDrag);
}

function handlePointerMove(event: PointerEvent) {
  const current = dragState.value;
  if (!current || current.pointerId !== event.pointerId) return;

  emit('drag', {
    nodeId: current.nodeId,
    x: current.originX + (event.clientX - current.startClientX) / props.scale,
    y: current.originY + (event.clientY - current.startClientY) / props.scale,
  });
}

function stopDrag() {
  dragState.value = null;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('pointercancel', stopDrag);
}

function handleNodeKeydown(event: KeyboardEvent, nodeId: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('select', nodeId);
  }
}

function getEdgePath(edge: OutlineEdge) {
  const source = nodesById.value.get(edge.source);
  const target = nodesById.value.get(edge.target);
  if (!source || !target) return '';

  const sourceCenter = {
    x: source.x + OUTLINE_NODE_WIDTH / 2,
    y: source.y + OUTLINE_NODE_HEIGHT / 2,
  };
  const targetCenter = {
    x: target.x + OUTLINE_NODE_WIDTH / 2,
    y: target.y + OUTLINE_NODE_HEIGHT / 2,
  };
  const isVertical = props.view === 'timeline-vertical';
  const horizontalDistance = Math.abs(targetCenter.x - sourceCenter.x);
  const verticalDistance = Math.abs(targetCenter.y - sourceCenter.y);
  const horizontal = !isVertical && horizontalDistance >= verticalDistance;

  if (horizontal) {
    const direction = targetCenter.x >= sourceCenter.x ? 1 : -1;
    const start = {
      x: sourceCenter.x + direction * OUTLINE_NODE_WIDTH / 2,
      y: sourceCenter.y,
    };
    const end = {
      x: targetCenter.x - direction * OUTLINE_NODE_WIDTH / 2,
      y: targetCenter.y,
    };
    const bend = Math.max(48, Math.abs(end.x - start.x) * 0.38);
    return `M ${start.x} ${start.y} C ${start.x + direction * bend} ${start.y}, ${end.x - direction * bend} ${end.y}, ${end.x} ${end.y}`;
  }

  const direction = targetCenter.y >= sourceCenter.y ? 1 : -1;
  const start = {
    x: sourceCenter.x,
    y: sourceCenter.y + direction * OUTLINE_NODE_HEIGHT / 2,
  };
  const end = {
    x: targetCenter.x,
    y: targetCenter.y - direction * OUTLINE_NODE_HEIGHT / 2,
  };
  const bend = Math.max(48, Math.abs(end.y - start.y) * 0.38);
  return `M ${start.x} ${start.y} C ${start.x} ${start.y + direction * bend}, ${end.x} ${end.y - direction * bend}, ${end.x} ${end.y}`;
}

function getEdgeLabelPosition(edge: OutlineEdge) {
  const source = nodesById.value.get(edge.source);
  const target = nodesById.value.get(edge.target);
  if (!source || !target) return { x: 0, y: 0 };

  return {
    x: (source.x + target.x + OUTLINE_NODE_WIDTH) / 2,
    y: (source.y + target.y + OUTLINE_NODE_HEIGHT) / 2,
  };
}

function nodeTypeLabel(type: OutlineNodeType) {
  return OUTLINE_NODE_TYPE_LABELS[type];
}

onBeforeUnmount(stopDrag);
</script>

<template>
  <div class="story-outline-canvas-scroll" @pointerdown.self="emit('clear')">
    <div class="story-outline-canvas-stage" :style="stageStyle">
      <div class="story-outline-canvas-surface" :style="surfaceStyle">
        <svg
          class="story-outline-edges"
          :width="layout.width"
          :height="layout.height"
          :viewBox="`0 0 ${layout.width} ${layout.height}`"
          aria-hidden="true"
        >
          <defs>
            <marker id="story-outline-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
            </marker>
          </defs>
          <g v-for="edge in edges" :key="edge.id" class="story-outline-edge">
            <path :d="getEdgePath(edge)" marker-end="url(#story-outline-arrow)" />
            <text v-if="edge.label" :x="getEdgeLabelPosition(edge).x" :y="getEdgeLabelPosition(edge).y">
              {{ edge.label }}
            </text>
          </g>
        </svg>

        <article
          v-for="node in layout.nodes"
          :key="node.id"
          class="story-outline-node"
          :class="[`is-${node.type}`, { 'is-selected': selectedId === node.id }]"
          :style="{ left: `${node.x}px`, top: `${node.y}px` }"
          :aria-label="`${node.title}，${nodeTypeLabel(node.type)}`"
          role="button"
          tabindex="0"
          @click.stop="emit('select', node.id)"
          @dblclick.stop="emit('edit', node.id)"
          @keydown="handleNodeKeydown($event, node.id)"
          @pointerdown="startDrag($event, node)"
        >
          <div class="story-outline-node-meta">
            <span>{{ nodeTypeLabel(node.type) }}</span>
            <span v-if="node.lane">{{ node.lane }}</span>
          </div>
          <strong>{{ node.title }}</strong>
          <p>{{ node.summary }}</p>
          <div v-if="selectedId === node.id" class="story-outline-node-actions">
            <button type="button" @click.stop="emit('edit', node.id)">编辑</button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
