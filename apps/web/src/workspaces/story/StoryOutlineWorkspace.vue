<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import StoryOutlineCanvas from './StoryOutlineCanvas.vue';
import StoryOutlineNodeEditor from './StoryOutlineNodeEditor.vue';
import {
  buildOutlineLayout,
  clampOutlinePosition,
  createOutlineSeed,
  getDefaultView,
  getViewsForMode,
  insertOutlineNode,
  removeOutlineNode,
  updateOutlineNode,
} from './story-outline-layout';
import {
  OUTLINE_VIEW_LABELS,
  type OutlineMode,
  type OutlineNode,
  type OutlinePositionMap,
  type OutlineView,
} from './story-outline-types';

const modeOptions: { key: OutlineMode; label: string; description: string }[] = [
  { key: 'timeline', label: '时间轴', description: '看清故事如何推进' },
  { key: 'organization', label: '世界构成', description: '理解人物、地点与组织的关系' },
];

const outlineDocument = createOutlineSeed();
const outlineNodes = ref<OutlineNode[]>(outlineDocument.nodes);
const outlineEdges = ref(outlineDocument.edges);
const currentMode = ref<OutlineMode>('organization');
const currentView = ref<OutlineView>(getDefaultView('organization'));
const selectedNodeId = ref<string | null>(null);
const zoom = ref(1);
const statusMessage = ref('已载入示例大纲。');
const editorOpen = ref(false);
const editorMode = ref<'create' | 'edit'>('create');
const editorNodeId = ref<string | null>(null);

const positionOverrides = reactive<Record<OutlineView, OutlinePositionMap>>({
  'timeline-horizontal': {},
  'timeline-vertical': {},
  'timeline-fishbone': {},
  'organization-logic': {},
  'organization-mindmap': {},
});

const currentViewOptions = computed(() => getViewsForMode(currentMode.value));
const currentViewLabel = computed(() => OUTLINE_VIEW_LABELS[currentView.value]);
const currentLayout = computed(() =>
  buildOutlineLayout(
    outlineNodes.value,
    outlineEdges.value,
    currentView.value,
    positionOverrides[currentView.value],
  ),
);
const selectedNode = computed(
  () =>
    outlineNodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
);
const editorNode = computed(
  () => outlineNodes.value.find((node) => node.id === editorNodeId.value) ?? null,
);

function setMode(mode: OutlineMode) {
  currentMode.value = mode;
  currentView.value = getDefaultView(mode);
  zoom.value = 1;
  statusMessage.value = `已切换到${modeOptions.find((item) => item.key === mode)?.label ?? ''}。`;
}

function setView(view: OutlineView) {
  currentView.value = view;
  zoom.value = 1;
  statusMessage.value = `当前视图：${OUTLINE_VIEW_LABELS[view]}。`;
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId;
}

function clearSelection() {
  selectedNodeId.value = null;
}

function openCreateEditor() {
  editorMode.value = 'create';
  editorNodeId.value = null;
  editorOpen.value = true;
}

function openEditEditor(nodeId: string) {
  selectedNodeId.value = nodeId;
  editorMode.value = 'edit';
  editorNodeId.value = nodeId;
  editorOpen.value = true;
}

function closeEditor() {
  editorOpen.value = false;
  editorNodeId.value = null;
}

function saveNode(payload: {
  title: string;
  summary: string;
  type: OutlineNode['type'];
}) {
  if (editorMode.value === 'edit' && editorNodeId.value) {
    outlineNodes.value = updateOutlineNode(
      outlineNodes.value,
      editorNodeId.value,
      payload,
    );
    selectedNodeId.value = editorNodeId.value;
    statusMessage.value = `已更新节点「${payload.title}」。`;
  } else {
    const selected = selectedNode.value;
    const next = insertOutlineNode(
      outlineNodes.value,
      outlineEdges.value,
      {
        ...payload,
        lane: selected?.lane ?? '主线',
      },
      selectedNodeId.value,
    );
    outlineNodes.value = next.nodes;
    outlineEdges.value = next.edges;
    const created = next.nodes.find((node) => node.title === payload.title);
    selectedNodeId.value = created?.id ?? null;
    statusMessage.value = `已加入节点「${payload.title}」。`;
  }
  closeEditor();
}

function deleteNode() {
  const nodeId = editorNodeId.value;
  const node = editorNode.value;
  if (!nodeId || !node) return;
  if (
    typeof window !== 'undefined' &&
    !window.confirm(`确定删除「${node.title}」吗？相关关系也会被移除。`)
  ) {
    return;
  }

  const next = removeOutlineNode(
    outlineNodes.value,
    outlineEdges.value,
    nodeId,
  );
  outlineNodes.value = next.nodes;
  outlineEdges.value = next.edges;
  delete positionOverrides[currentView.value][nodeId];
  selectedNodeId.value = null;
  statusMessage.value = `已删除节点「${node.title}」。`;
  closeEditor();
}

function moveNode(payload: { nodeId: string; x: number; y: number }) {
  positionOverrides[currentView.value][payload.nodeId] = clampOutlinePosition({
    x: payload.x,
    y: payload.y,
  });
}

function changeZoom(delta: number) {
  zoom.value = Math.min(1.8, Math.max(0.6, Number((zoom.value + delta).toFixed(2))));
}

function resetLayout() {
  positionOverrides[currentView.value] = {};
  zoom.value = 1;
  statusMessage.value = `已重置${currentViewLabel.value}布局。`;
}
</script>

<template>
  <section class="story-outline-workspace" aria-labelledby="story-outline-workspace-title">
    <header class="story-outline-workspace-header">
      <div>
        <span class="story-outline-kicker">结构资产 / OUTLINE</span>
        <h2 id="story-outline-workspace-title">故事结构底稿</h2>
        <p>先把事件、人物和冲突放在同一张桌面上，再决定故事要沿哪条路径生长。</p>
      </div>
      <button class="story-outline-primary-button story-outline-add-button" type="button" @click="openCreateEditor">
        <span aria-hidden="true">＋</span>
        新增节点
      </button>
    </header>

    <div class="story-outline-mode-tabs" role="tablist" aria-label="大纲组织模式">
      <button
        v-for="option in modeOptions"
        :key="option.key"
        class="story-outline-mode-tab"
        :class="{ 'is-active': currentMode === option.key }"
        type="button"
        role="tab"
        :aria-selected="currentMode === option.key"
        @click="setMode(option.key)"
      >
        <strong>{{ option.label }}</strong>
        <span>{{ option.description }}</span>
      </button>
    </div>

    <div class="story-outline-toolbar">
      <div class="story-outline-view-tabs" role="tablist" aria-label="大纲视图">
        <button
          v-for="view in currentViewOptions"
          :key="view"
          class="story-outline-view-tab"
          :class="{ 'is-active': currentView === view }"
          type="button"
          role="tab"
          :aria-selected="currentView === view"
          @click="setView(view)"
        >
          {{ OUTLINE_VIEW_LABELS[view] }}
        </button>
      </div>

      <div class="story-outline-canvas-tools" aria-label="画布工具">
        <span class="story-outline-zoom-value">{{ Math.round(zoom * 100) }}%</span>
        <button class="story-outline-icon-button" type="button" aria-label="缩小画布" title="缩小" @click="changeZoom(-0.1)">−</button>
        <button class="story-outline-icon-button" type="button" aria-label="放大画布" title="放大" @click="changeZoom(0.1)">＋</button>
        <button class="story-outline-text-button" type="button" @click="resetLayout">重置布局</button>
      </div>
    </div>

    <div class="story-outline-canvas-meta">
      <span>{{ currentViewLabel }}</span>
      <span>{{ outlineNodes.length }} 个节点 · {{ outlineEdges.length }} 条关系</span>
      <span v-if="selectedNode">已选中：{{ selectedNode.title }}</span>
    </div>

    <div class="story-outline-content">
      <div class="story-outline-canvas-panel">
        <StoryOutlineCanvas
          :layout="currentLayout"
          :edges="outlineEdges"
          :view="currentView"
          :scale="zoom"
          :selected-id="selectedNodeId"
          @select="selectNode"
          @clear="clearSelection"
          @edit="openEditEditor"
          @drag="moveNode"
        />
      </div>

      <StoryOutlineNodeEditor
        :open="editorOpen"
        :mode="editorMode"
        :node="editorNode"
        @save="saveNode"
        @cancel="closeEditor"
        @delete="deleteNode"
      />
    </div>

    <p class="story-outline-status" aria-live="polite">{{ statusMessage }}</p>
  </section>
</template>
