<script setup lang="ts">
import { computed } from 'vue';

import {
  deriveWorldviewFactGraph,
  type WorldviewEntity,
  type WorldviewEntityType,
  type WorldviewKnowledgeGraphState,
} from './story-worldview-ontology';

const props = defineProps<{
  state: WorldviewKnowledgeGraphState;
  selectedEntityId: string | null;
}>();

const emit = defineEmits<{
  selectEntity: [entityId: string | null];
}>();

type PositionedEntity = {
  entity: WorldviewEntity;
  x: number;
  y: number;
};

const typeAnchors: Record<WorldviewEntityType, { x: number; y: number }> = {
  角色: { x: 58, y: 58 },
  组织: { x: 328, y: 58 },
  地点: { x: 598, y: 58 },
  规则: { x: 328, y: 228 },
};

const graph = computed(() => deriveWorldviewFactGraph(props.state));
const selectedEntity = computed(
  () =>
    graph.value.nodes.find((node) => node.id === props.selectedEntityId) ??
    null,
);
const positionedEntities = computed<PositionedEntity[]>(() => {
  const typeIndexes = new Map<WorldviewEntityType, number>();
  return graph.value.nodes.map((entity) => {
    const index = typeIndexes.get(entity.type) ?? 0;
    typeIndexes.set(entity.type, index + 1);
    const anchor = typeAnchors[entity.type];
    return {
      entity,
      x: anchor.x,
      y: anchor.y + index * 78,
    };
  });
});
const positionByEntityId = computed(
  () =>
    new Map(
      positionedEntities.value.map((positioned) => [
        positioned.entity.id,
        positioned,
      ]),
    ),
);
const positionedEdges = computed(() =>
  graph.value.edges.flatMap((edge) => {
    const source = positionByEntityId.value.get(edge.source.id);
    const target = positionByEntityId.value.get(edge.target.id);
    if (!source || !target) return [];

    const sourceX = source.x + 160;
    const sourceY = source.y + 29;
    const targetX = target.x;
    const targetY = target.y + 29;
    const isReverse = targetX < sourceX;
    const startX = isReverse ? source.x : sourceX;
    const endX = isReverse ? target.x + 160 : targetX;
    const bend = Math.max(54, Math.abs(endX - startX) * 0.42);
    const control1X = startX + (isReverse ? -bend : bend);
    const control2X = endX + (isReverse ? bend : -bend);

    return [
      {
        ...edge,
        path: `M ${startX} ${sourceY} C ${control1X} ${sourceY}, ${control2X} ${targetY}, ${endX} ${targetY}`,
        labelX: (startX + endX) / 2,
        labelY: (sourceY + targetY) / 2 - 8,
      },
    ];
  }),
);

function isEntityRelated(entityId: string) {
  if (!props.selectedEntityId) return true;
  if (entityId === props.selectedEntityId) return true;
  return graph.value.edges.some(
    (edge) =>
      (edge.source.id === props.selectedEntityId &&
        edge.target.id === entityId) ||
      (edge.target.id === props.selectedEntityId &&
        edge.source.id === entityId),
  );
}

function isEdgeRelated(subjectId: string, objectId: string) {
  if (!props.selectedEntityId) return true;
  return (
    subjectId === props.selectedEntityId || objectId === props.selectedEntityId
  );
}

function handleNodeKeydown(event: KeyboardEvent, entityId: string) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  emit('selectEntity', entityId);
}
</script>

<template>
  <section
    class="worldview-fact-graph"
    aria-labelledby="worldview-fact-graph-title"
  >
    <header class="worldview-fact-graph-heading">
      <div>
        <span>FACT GRAPH / READ ONLY</span>
        <h4 id="worldview-fact-graph-title">世界事实关系图</h4>
        <p>图谱负责浏览与筛选，事实的增删改统一在下方清单完成。</p>
      </div>
      <div class="worldview-fact-graph-state">
        <strong v-if="selectedEntity"
          >正在查看 · {{ selectedEntity.name }}</strong
        >
        <strong v-else>全部事实 · {{ graph.edges.length }} 条</strong>
        <button
          v-if="selectedEntityId"
          type="button"
          @click="emit('selectEntity', null)"
        >
          清除筛选
        </button>
      </div>
    </header>

    <div v-if="graph.nodes.length" class="worldview-fact-graph-canvas">
      <svg
        viewBox="0 0 816 356"
        role="img"
        aria-labelledby="worldview-fact-graph-title"
      >
        <defs>
          <pattern
            id="worldview-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 24 0 L 0 0 0 24" />
          </pattern>
          <marker
            id="worldview-fact-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>

        <rect
          class="worldview-fact-graph-background"
          width="816"
          height="356"
          fill="url(#worldview-grid)"
          @click="emit('selectEntity', null)"
        />

        <g class="worldview-fact-edges">
          <g
            v-for="edge in positionedEdges"
            :key="edge.id"
            :class="{
              'is-dimmed': !isEdgeRelated(edge.source.id, edge.target.id),
              'is-selected':
                isEdgeRelated(edge.source.id, edge.target.id) &&
                selectedEntityId,
            }"
          >
            <path class="worldview-fact-edge-line" :d="edge.path" />
            <text
              class="worldview-fact-edge-label"
              :x="edge.labelX"
              :y="edge.labelY"
              text-anchor="middle"
            >
              {{ edge.predicate.label }}
            </text>
          </g>
        </g>

        <g class="worldview-fact-nodes">
          <g
            v-for="positioned in positionedEntities"
            :key="positioned.entity.id"
            class="worldview-fact-node"
            :class="{
              'is-selected': positioned.entity.id === selectedEntityId,
              'is-dimmed': !isEntityRelated(positioned.entity.id),
            }"
            role="button"
            tabindex="0"
            :aria-label="`筛选${positioned.entity.type}${positioned.entity.name}`"
            :transform="`translate(${positioned.x} ${positioned.y})`"
            @click.stop="emit('selectEntity', positioned.entity.id)"
            @keydown="handleNodeKeydown($event, positioned.entity.id)"
          >
            <rect width="160" height="58" />
            <text class="worldview-fact-node-type" x="14" y="19">
              {{ positioned.entity.type }}
            </text>
            <text class="worldview-fact-node-name" x="14" y="42">
              {{ positioned.entity.name }}
            </text>
          </g>
        </g>
      </svg>
    </div>

    <div v-else class="worldview-fact-graph-empty">
      <strong>还没有世界实体</strong>
      <p>先从左侧目录建立实体，再在事实清单中创建关系。</p>
    </div>
  </section>
</template>

<style scoped>
.worldview-fact-graph {
  min-width: 0;
  border-bottom: 2px solid var(--story-worldview-border-strong);
}

.worldview-fact-graph-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0 14px;
}

.worldview-fact-graph-heading span,
.worldview-fact-graph-state strong {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.56rem;
  font-weight: 400;
  letter-spacing: 0.1em;
}

.worldview-fact-graph-heading h4 {
  margin: 6px 0 4px;
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 1.3rem;
  font-weight: 400;
}

.worldview-fact-graph-heading p {
  margin: 0;
  color: var(--story-entry-muted);
  font-size: 0.66rem;
  line-height: 1.6;
}

.worldview-fact-graph-state {
  display: grid;
  flex: 0 0 auto;
  gap: 8px;
  justify-items: end;
}

.worldview-fact-graph-state button {
  min-height: 28px;
  padding: 4px 9px;
  border: 1px solid var(--story-worldview-border-strong);
  color: var(--story-entry-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.6rem;
}

.worldview-fact-graph-state button:hover,
.worldview-fact-graph-state button:focus-visible {
  border-color: var(--story-entry-blue);
  color: var(--story-entry-blue);
}

.worldview-fact-graph-canvas {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--story-worldview-border);
  background: color-mix(
    in srgb,
    var(--story-entry-canvas) 82%,
    var(--story-entry-paper)
  );
}

.worldview-fact-graph-canvas svg {
  display: block;
  width: 100%;
  height: auto;
  min-height: 250px;
}

.worldview-fact-graph-background {
  color: var(--story-worldview-border);
}

#worldview-grid path {
  fill: none;
  stroke: currentcolor;
  stroke-width: 0.45;
}

#worldview-fact-arrow path {
  fill: var(--story-worldview-border-strong);
}

.worldview-fact-edge-line {
  fill: none;
  stroke: var(--story-worldview-border-strong);
  stroke-width: 1.4;
  marker-end: url(#worldview-fact-arrow);
}

.worldview-fact-edge-label {
  fill: var(--story-entry-ink);
  stroke: var(--story-entry-canvas);
  stroke-width: 5px;
  paint-order: stroke;
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 10px;
}

.worldview-fact-edges > g,
.worldview-fact-node {
  transition: opacity 150ms ease;
}

.worldview-fact-edges > g.is-dimmed,
.worldview-fact-node.is-dimmed {
  opacity: 0.2;
}

.worldview-fact-edges > g.is-selected .worldview-fact-edge-line {
  stroke: var(--story-entry-blue);
  stroke-width: 2.2;
}

.worldview-fact-node {
  cursor: pointer;
}

.worldview-fact-node rect {
  fill: var(--story-entry-paper);
  stroke: var(--story-worldview-border-strong);
  stroke-width: 1.2;
}

.worldview-fact-node:hover rect,
.worldview-fact-node:focus-visible rect,
.worldview-fact-node.is-selected rect {
  stroke: var(--story-entry-blue);
  stroke-width: 2.4;
}

.worldview-fact-node-type {
  fill: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 9px;
  letter-spacing: 0.08em;
}

.worldview-fact-node-name {
  fill: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 13px;
}

.worldview-fact-graph-empty {
  display: grid;
  min-height: 250px;
  place-content: center;
  text-align: center;
}

.worldview-fact-graph-empty strong {
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-fact-graph-empty p {
  margin: 8px 0 0;
  color: var(--story-entry-muted);
  font-size: 0.68rem;
}

@media (max-width: 700px) {
  .worldview-fact-graph-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .worldview-fact-graph-state {
    justify-items: start;
  }

  .worldview-fact-graph-canvas {
    min-height: 300px;
  }
}
</style>
