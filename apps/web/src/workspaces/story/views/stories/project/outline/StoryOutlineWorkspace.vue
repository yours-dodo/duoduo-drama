<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import StoryOutlineCanvas from './StoryOutlineCanvas.vue';
import {
  createIdempotencyKey,
  getPersonalStoryProject,
  getStoryOutline,
  getStoryProject,
  saveStoryOutline,
  type StoryArtifactVersion,
} from '../../../../api/story-api';
import {
  buildOutlineLayout,
  clampOutlinePosition,
  getDefaultView,
  getViewsForMode,
  type OutlineDocument,
} from './story-outline-layout';
import {
  OUTLINE_VIEW_LABELS,
  type OutlineMode,
  type OutlineView,
} from './story-outline-types';
import {
  StoryOutlineAutosave,
  type StoryOutlineAutosaveState,
} from './story-outline-autosave';
import {
  createNarrativeMaterialPreviewDocument,
  type NarrativeMaterialPreview,
  type NarrativeMaterialPreviewRequest,
} from './story-outline-material-preview';
import {
  createNarrativeDocument,
  NARRATIVE_CANVAS_ASSET_LABELS,
  narrativeDocumentToOutline,
  normalizeNarrativeDocument,
  parseNarrativeDocument,
  removeNarrativeArc,
  removeNarrativeChapter,
  type NarrativeCanvasAssetType,
  type NarrativeDocument,
} from './story-narrative-types';
import {
  activateOutlineOwner,
  clearCanvasPositions,
  readCanvasPositions,
  writeCanvasPosition,
} from './story-outline-workspace-state';

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));
const teamId = computed(() => {
  const value = route.query.teamId;
  return typeof value === 'string' && value ? value : null;
});
const scope = computed(() => ({
  teamId: teamId.value,
  projectId: projectId.value,
}));

const document = ref<NarrativeDocument | null>(null);
const currentVersion = ref<StoryArtifactVersion | null>(null);
const projectTitle = ref('叙事规划');
const viewState = ref<'loading' | 'ready' | 'error'>('loading');
const currentView = ref<OutlineView>('timeline-horizontal');
const activeOwnerId = ref('');
const canvasActivationSequence = ref(0);
const selectedId = ref<string | null>(null);
const focusRequest = ref<{ nodeId: string; sequence: number } | null>(null);
const saveState = ref<StoryOutlineAutosaveState>('idle');
const navigatorCollapsed = ref(false);
const materialPreviewRequest = ref<NarrativeMaterialPreviewRequest | null>(
  null,
);
const viewMode = ref<OutlineMode>('timeline');
let suppressAutosave = true;

const autosave = new StoryOutlineAutosave<StoryArtifactVersion>({
  readContent: () =>
    document.value && projectId.value ? JSON.stringify(document.value) : null,
  readExpectedVersionNumber: () => currentVersion.value?.versionNumber ?? 0,
  createIdempotencyKey: () => createIdempotencyKey('save-story-outline'),
  save: async (batch) => {
    const result = await saveStoryOutline(
      scope.value,
      {
        content: batch.content,
        expectedVersionNumber: batch.expectedVersionNumber,
      },
      batch.idempotencyKey,
    );
    return result.version;
  },
  onSaved: (version) => {
    currentVersion.value = version;
  },
  onStateChange: (state) => {
    saveState.value = state;
  },
});

const viewModeOptions: readonly { value: OutlineMode; label: string }[] = [
  { value: 'timeline', label: '时间轴' },
  { value: 'organization', label: '导图' },
];
const viewOptions = computed(() => getViewsForMode(viewMode.value));

const outlineDocument = computed<OutlineDocument>(() =>
  document.value
    ? narrativeDocumentToOutline(
        document.value,
        activeOwnerId.value || document.value.rootStoryId,
      )
    : { nodes: [], edges: [] },
);
const positionOverrides = computed(() =>
  document.value
    ? readCanvasPositions(
        document.value.canvases,
        activeOwnerId.value,
        currentView.value,
      )
    : {},
);
const currentLayout = computed(() =>
  buildOutlineLayout(
    outlineDocument.value.nodes,
    outlineDocument.value.edges,
    currentView.value,
    positionOverrides.value,
  ),
);
const materialPreview = computed<NarrativeMaterialPreview | null>(() => {
  if (!materialPreviewRequest.value) return null;

  const preview = createNarrativeMaterialPreviewDocument(
    outlineDocument.value,
    materialPreviewRequest.value,
  );
  if (!preview) return null;

  return {
    ...preview,
    layout: buildOutlineLayout(
      preview.document.nodes,
      preview.document.edges,
      currentView.value,
      positionOverrides.value,
    ),
  };
});
const arcsWithChapters = computed(
  () =>
    document.value?.arcs.map((arc) => ({
      arc,
      chapters: document.value?.chapters
        .filter((chapter) => chapter.arcId === arc.id)
        .sort((left, right) => left.order - right.order),
    })) ?? [],
);
const materialDropTargetIds = computed(() =>
  outlineDocument.value.nodes.map((node) => node.id),
);
const saveStateLabel = computed(() => {
  if (saveState.value === 'pending') return '待保存';
  if (saveState.value === 'saving') return '正在保存';
  if (saveState.value === 'saved') {
    return currentVersion.value
      ? `已保存 · v${currentVersion.value.versionNumber}`
      : '已保存';
  }
  if (saveState.value === 'error') return '保存失败 · 点击重试';
  return '';
});

watch(viewMode, (mode) => {
  currentView.value = getDefaultView(mode);
});
watch(currentView, () => {
  materialPreviewRequest.value = null;
});

onMounted(() => {
  void loadOutline();
});
onBeforeUnmount(() => {
  autosave.dispose();
});

watch(
  document,
  () => {
    if (suppressAutosave || viewState.value !== 'ready') return;
    autosave.schedule();
  },
  { deep: true },
);

async function loadOutline() {
  viewState.value = 'loading';
  suppressAutosave = true;
  try {
    const [outlineResult, projectResult] = await Promise.all([
      getStoryOutline(scope.value),
      teamId.value
        ? getStoryProject(teamId.value, projectId.value)
        : getPersonalStoryProject(projectId.value),
    ]);
    projectTitle.value = projectResult.project.title || '叙事规划';
    currentVersion.value = outlineResult.currentVersion;
    const parsed = parseNarrativeDocument(
      outlineResult.currentVersion?.content,
      { title: projectTitle.value },
    );
    if (parsed.source === 'invalid') {
      throw new Error('当前大纲版本无法安全读取');
    }
    document.value = normalizeNarrativeDocument(parsed.document);
    resetActiveOwner(document.value.story.id);
    currentView.value = 'timeline-horizontal';
    viewMode.value = 'timeline';
    viewState.value = 'ready';
    suppressAutosave = false;
    if (parsed.migrated) autosave.schedule();
  } catch {
    document.value = createNarrativeDocument({ title: projectTitle.value });
    resetActiveOwner(document.value.story.id);
    viewState.value = 'error';
    suppressAutosave = false;
  }
}

function selectEntity(entityId: string) {
  if (!document.value?.canvases[entityId]) return;
  const next = activateOutlineOwner(
    {
      activeOwnerId: activeOwnerId.value,
      selectedId: selectedId.value,
      focusRequest: focusRequest.value,
      materialPreviewRequest: materialPreviewRequest.value,
      activationSequence: canvasActivationSequence.value,
    },
    entityId,
  );
  if (next.activeOwnerId === activeOwnerId.value) {
    selectedId.value = entityId;
    return;
  }
  activeOwnerId.value = next.activeOwnerId;
  selectedId.value = next.selectedId;
  focusRequest.value = null;
  materialPreviewRequest.value = null;
  canvasActivationSequence.value = next.activationSequence;
}
function resetActiveOwner(ownerId: string) {
  activeOwnerId.value = ownerId;
  selectedId.value = ownerId;
  focusRequest.value = null;
  materialPreviewRequest.value = null;
  canvasActivationSequence.value += 1;
}
function selectCanvasNode(nodeId: string) {
  selectedId.value = nodeId;
}
function clearSelection() {
  selectedId.value = null;
}
function addArc() {
  if (!document.value) return;
  const id = createEntityId('arc');
  document.value.arcs.push({
    id,
    type: 'arc',
    title: `第${document.value.arcs.length + 1}幕`,
    summary: '',
    order: document.value.arcs.length,
    chapterIds: [],
  });
  document.value.story.arcIds.push(id);
  document.value = normalizeNarrativeDocument(document.value);
  selectEntity(id);
}
function deleteArc(arcId: string) {
  if (!document.value) return;

  const arc = document.value.arcs.find((candidate) => candidate.id === arcId);
  const result = removeNarrativeArc(document.value, arcId);
  const targetArc = result.targetArcId
    ? document.value.arcs.find(
        (candidate) => candidate.id === result.targetArcId,
      )
    : null;
  if (!arc || !result.removed || !targetArc) return;

  const chapterCount = result.migratedChapterIds.length;
  const confirmation = chapterCount
    ? `删除“${arc.title}”？其中 ${chapterCount} 个章节将迁移到“${targetArc.title}”。`
    : `删除空幕“${arc.title}”？`;
  if (!window.confirm(confirmation)) return;

  const wasActive = activeOwnerId.value === arcId;
  document.value = result.document;
  if (wasActive) resetActiveOwner(document.value.story.id);
}
function addChapter(arcId: string) {
  if (!document.value) return;
  const chapters = document.value.chapters.filter(
    (chapter) => chapter.arcId === arcId,
  );
  const id = createEntityId('chapter');
  document.value.chapters.push({
    id,
    type: 'chapter',
    title: `第${document.value.chapters.length + 1}章`,
    summary: '',
    order: chapters.length,
    arcId,
    goals: [],
    openingState: '',
    beatIds: [],
    informationRelease: {
      readerKnows: [],
      characterKnows: [],
      mustNotReveal: [],
    },
    stateDelta: [],
    referenceIds: [],
  });
  document.value.arcs.find((arc) => arc.id === arcId)?.chapterIds.push(id);
  document.value = normalizeNarrativeDocument(document.value);
  selectEntity(id);
}
function deleteChapter(chapterId: string) {
  if (!document.value) return;

  const chapter = document.value.chapters.find(
    (candidate) => candidate.id === chapterId,
  );
  const result = removeNarrativeChapter(document.value, chapterId);
  if (!chapter || !result.removed || !result.parentArcId) return;

  const beatCount = result.removedBeatIds.length;
  const confirmation = beatCount
    ? `删除“${chapter.title}”？该章节及其 ${beatCount} 个 Beat 将被永久删除。`
    : `删除“${chapter.title}”？`;
  if (!window.confirm(confirmation)) return;

  const wasActive = activeOwnerId.value === chapterId;
  document.value = result.document;
  if (wasActive) resetActiveOwner(document.value.story.id);
}
function moveNode(payload: { nodeId: string; x: number; y: number }) {
  if (!document.value) return;
  writeCanvasPosition(
    document.value.canvases,
    activeOwnerId.value,
    currentView.value,
    payload.nodeId,
    clampOutlinePosition(payload),
  );
}
function relayoutCurrentView() {
  if (!document.value) return;
  clearCanvasPositions(
    document.value.canvases,
    activeOwnerId.value,
    currentView.value,
  );
}
function addNarrativeMaterial(payload: {
  type: NarrativeCanvasAssetType;
  parentId: string;
}) {
  if (!document.value) return;
  const canvas = document.value.canvases[activeOwnerId.value];
  if (!canvas) return;
  const validParentIds = new Set(
    outlineDocument.value.nodes.map((node) => node.id),
  );
  if (!validParentIds.has(payload.parentId)) return;

  const { type } = payload;
  const label = NARRATIVE_CANVAS_ASSET_LABELS[type];
  const sequence = canvas.nodes.filter((node) => node.type === type).length + 1;
  const id = createEntityId(type);
  canvas.nodes.push({
    id,
    type,
    title: `未命名${label}${sequence > 1 ? sequence : ''}`,
    summary: `待补充${label}说明`,
    order: canvas.nodes.length,
    refId: id,
    parentId: payload.parentId,
  });
  canvas.edges.push({
    id: `narrative-asset-${payload.parentId}-${id}`,
    source: payload.parentId,
    target: id,
    kind: 'relation',
    label,
  });
  selectedId.value = id;
}
function setMaterialPreview(request: NarrativeMaterialPreviewRequest | null) {
  materialPreviewRequest.value = request;
}
function createEntityId(type: string) {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `narrative-${type}-${uuid}`;
}
</script>

<template>
  <section class="story-narrative-workspace" aria-label="叙事规划工作区">
    <div
      v-if="viewState === 'loading'"
      class="story-narrative-state"
      role="status"
    >
      正在载入叙事文档…
    </div>
    <div
      v-else
      class="story-narrative-columns"
      :class="{ 'is-navigator-collapsed': navigatorCollapsed }"
    >
      <aside
        class="story-narrative-navigator"
        :class="{ 'is-collapsed': navigatorCollapsed }"
        aria-label="叙事导航"
      >
        <div
          class="story-narrative-panel-heading"
          :class="{ 'is-collapsed': navigatorCollapsed }"
        >
          <button
            type="button"
            class="story-narrative-navigator-toggle"
            aria-controls="story-narrative-tree"
            :aria-expanded="!navigatorCollapsed"
            :aria-label="navigatorCollapsed ? '展开目录' : '折叠目录'"
            :title="navigatorCollapsed ? '展开目录' : '折叠目录'"
            @click="navigatorCollapsed = !navigatorCollapsed"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
              <path
                :d="
                  navigatorCollapsed
                    ? 'M7.5 4.5 13 10l-5.5 5.5'
                    : 'M12.5 4.5 7 10l5.5 5.5'
                "
              />
            </svg>
          </button>
          <button
            v-if="!navigatorCollapsed"
            type="button"
            class="story-narrative-small-button"
            @click="addArc"
          >
            + 幕
          </button>
        </div>
        <div
          v-if="!navigatorCollapsed"
          id="story-narrative-tree"
          class="story-narrative-tree"
        >
          <button
            v-if="document"
            type="button"
            class="story-narrative-tree-root"
            :class="{ 'is-selected': activeOwnerId === document.story.id }"
            @click="selectEntity(document.story.id)"
          >
            <span class="story-narrative-tree-mark">S</span
            ><span
              ><strong>{{ document.story.title }}</strong
              ><small>Story · 故事主干</small></span
            >
          </button>
          <div
            v-for="group in arcsWithChapters"
            :key="group.arc.id"
            class="story-narrative-tree-group"
          >
            <div class="story-narrative-tree-item">
              <button
                type="button"
                class="story-narrative-tree-row"
                :class="{ 'is-selected': activeOwnerId === group.arc.id }"
                @click="selectEntity(group.arc.id)"
              >
                <span class="story-narrative-tree-mark">A</span
                ><span
                  ><strong>{{ group.arc.title }}</strong
                  ><small>Arc · {{ group.chapters.length }} 章</small></span
                >
              </button>
              <button
                type="button"
                class="story-narrative-tree-delete"
                :disabled="(document?.arcs.length ?? 0) <= 1"
                :aria-label="`删除幕：${group.arc.title}`"
                :title="
                  (document?.arcs.length ?? 0) <= 1
                    ? '故事至少需要保留一个幕'
                    : `删除${group.arc.title}`
                "
                @click.stop="deleteArc(group.arc.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4.5 5.5h11M8 3.5h4M6.5 5.5l.55 10h5.9l.55-10M8.5 8v5M11.5 8v5"
                  />
                </svg>
              </button>
            </div>
            <div
              v-for="chapter in group.chapters"
              :key="chapter.id"
              class="story-narrative-tree-item"
            >
              <button
                type="button"
                class="story-narrative-tree-row is-chapter"
                :class="{ 'is-selected': activeOwnerId === chapter.id }"
                @click="selectEntity(chapter.id)"
              >
                <span class="story-narrative-tree-mark">{{
                  String(chapter.order + 1).padStart(2, '0')
                }}</span
                ><span
                  ><strong>{{ chapter.title }}</strong
                  ><small
                    >Chapter · {{ chapter.beatIds.length }} Beat</small
                  ></span
                >
              </button>
              <button
                type="button"
                class="story-narrative-tree-delete"
                :aria-label="`删除章节：${chapter.title}`"
                :title="`删除${chapter.title}`"
                @click.stop="deleteChapter(chapter.id)"
              >
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4.5 5.5h11M8 3.5h4M6.5 5.5l.55 10h5.9l.55-10M8.5 8v5M11.5 8v5"
                  />
                </svg>
              </button>
            </div>
            <button
              type="button"
              class="story-narrative-add-row"
              @click="addChapter(group.arc.id)"
            >
              + 添加章节
            </button>
          </div>
        </div>
      </aside>

      <main class="story-narrative-main" aria-label="叙事画布">
        <div class="story-narrative-canvas-wrap">
          <div class="story-narrative-view-toolbar">
            <select
              v-model="viewMode"
              class="story-narrative-view-mode"
              aria-label="布局类型"
            >
              <option
                v-for="option in viewModeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <div
              class="story-narrative-view-tabs"
              role="tablist"
              :aria-label="`${viewMode === 'timeline' ? '时间轴' : '导图'}视图`"
            >
              <button
                v-for="view in viewOptions"
                :key="view"
                type="button"
                :class="{ 'is-active': currentView === view }"
                @click="currentView = view"
              >
                {{ OUTLINE_VIEW_LABELS[view] }}
              </button>
            </div>
            <button
              v-if="saveStateLabel"
              type="button"
              class="story-narrative-save-state"
              :class="`is-${saveState}`"
              :disabled="saveState !== 'error'"
              role="status"
              aria-live="polite"
              @click="autosave.retry()"
            >
              {{ saveStateLabel }}
            </button>
          </div>
          <StoryOutlineCanvas
            :key="`${activeOwnerId}:${canvasActivationSequence}`"
            :layout="currentLayout"
            :edges="outlineDocument.edges"
            :view="currentView"
            :selected-id="selectedId"
            :focus-request="focusRequest"
            :material-drop-target-ids="materialDropTargetIds"
            :material-preview="materialPreview"
            @select="selectCanvasNode"
            @clear="clearSelection"
            @drag="moveNode"
            @relayout="relayoutCurrentView"
            @add-material="addNarrativeMaterial"
            @preview-material="setMaterialPreview"
          />
        </div>
      </main>
    </div>
  </section>
</template>
