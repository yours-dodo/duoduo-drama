<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRoute } from 'vue-router';

import StoryOutlineCanvas from './StoryOutlineCanvas.vue';
import {
  getPersonalStoryProject,
  getStoryOutline,
  getStoryProject,
  saveStoryOutline,
  type StoryArtifactVersion,
} from './story-api';
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
  type OutlinePositionMap,
  type OutlineView,
} from './story-outline-types';
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
const selectedId = ref<string | null>(null);
const focusRequest = ref<{ nodeId: string; sequence: number } | null>(null);
const saving = ref(false);
const navigatorCollapsed = ref(false);
const materialPreviewRequest = ref<NarrativeMaterialPreviewRequest | null>(
  null,
);
const positionOverrides = reactive<OutlinePositionMap>({});
const viewMode = ref<OutlineMode>('timeline');
let autosaveTimer: number | null = null;
let suppressAutosave = true;
let saveQueued = false;
let focusSequence = 0;

const viewModeOptions: readonly { value: OutlineMode; label: string }[] = [
  { value: 'timeline', label: '时间轴' },
  { value: 'organization', label: '导图' },
];
const viewOptions = computed(() => getViewsForMode(viewMode.value));

const outlineDocument = computed<OutlineDocument>(() =>
  document.value
    ? narrativeDocumentToOutline(document.value)
    : { nodes: [], edges: [] },
);
const currentLayout = computed(() =>
  buildOutlineLayout(
    outlineDocument.value.nodes,
    outlineDocument.value.edges,
    currentView.value,
    positionOverrides,
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
      positionOverrides,
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
  document.value
    ? [
        document.value.story.id,
        ...document.value.arcs.map((arc) => arc.id),
        ...document.value.chapters.map((chapter) => chapter.id),
        ...document.value.beats.map((beat) => beat.id),
      ]
    : [],
);

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
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
});

watch(
  document,
  () => {
    if (suppressAutosave || viewState.value !== 'ready') return;
    scheduleAutosave();
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
    document.value = normalizeNarrativeDocument(parsed.document);
    selectedId.value =
      document.value.chapters[0]?.id ?? document.value.story.id;
    viewState.value = 'ready';
    suppressAutosave = false;
    if (parsed.migrated) scheduleAutosave();
  } catch {
    document.value = createNarrativeDocument({ title: projectTitle.value });
    selectedId.value =
      document.value.chapters[0]?.id ?? document.value.story.id;
    viewState.value = 'error';
    suppressAutosave = false;
  }
}

function scheduleAutosave() {
  if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    autosaveTimer = null;
    void saveDocument();
  }, 800);
}

async function saveDocument() {
  if (!document.value || !projectId.value) return;
  if (saving.value) {
    saveQueued = true;
    return;
  }
  saving.value = true;
  try {
    const result = await saveStoryOutline(scope.value, {
      content: JSON.stringify(document.value),
      expectedVersionNumber: currentVersion.value?.versionNumber,
    });
    currentVersion.value = result.version;
  } catch {
    return;
  } finally {
    saving.value = false;
    if (saveQueued) {
      saveQueued = false;
      scheduleAutosave();
    }
  }
}

function selectEntity(entityId: string) {
  selectedId.value = entityId;
  focusRequest.value = {
    nodeId: entityId,
    sequence: ++focusSequence,
  };
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
  selectedId.value = id;
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

  const migratedChapterIds = new Set(result.migratedChapterIds);
  const migratedBeatIds = document.value.beats
    .filter((beat) => migratedChapterIds.has(beat.chapterId))
    .map((beat) => beat.id);
  [arcId, ...result.migratedChapterIds, ...migratedBeatIds].forEach(
    (nodeId) => delete positionOverrides[nodeId],
  );
  document.value = result.document;
  if (selectedId.value === arcId) selectEntity(targetArc.id);
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
  selectedId.value = id;
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

  [chapterId, ...result.removedBeatIds].forEach(
    (nodeId) => delete positionOverrides[nodeId],
  );
  document.value = result.document;
  if (
    selectedId.value === chapterId ||
    result.removedBeatIds.includes(selectedId.value ?? '')
  ) {
    selectEntity(result.parentArcId);
  }
}
function moveNode(payload: { nodeId: string; x: number; y: number }) {
  positionOverrides[payload.nodeId] = clampOutlinePosition(payload);
}
function relayoutCurrentView() {
  Object.keys(positionOverrides).forEach(
    (key) => delete positionOverrides[key],
  );
}
function addNarrativeMaterial(payload: {
  type: NarrativeCanvasAssetType;
  parentId: string;
}) {
  if (!document.value) return;

  const { type } = payload;
  const label = NARRATIVE_CANVAS_ASSET_LABELS[type];
  const sequence =
    document.value.assets.filter((asset) => asset.type === type).length + 1;
  const id = createEntityId(type);
  document.value.assets.push({
    id,
    type,
    refId: id,
    label: `未命名${label}${sequence > 1 ? sequence : ''}`,
    parentId: payload.parentId,
    relation: `待补充${label}说明`,
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
            :class="{ 'is-selected': selectedId === document.story.id }"
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
                :class="{ 'is-selected': selectedId === group.arc.id }"
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
                :class="{ 'is-selected': selectedId === chapter.id }"
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
          </div>
          <StoryOutlineCanvas
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
