<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import StoryWorldviewEntityDrawer from './StoryWorldviewEntityDrawer.vue';
import StoryWorldviewFactGraph from './StoryWorldviewFactGraph.vue';
import StoryWorldviewFactLedger from './StoryWorldviewFactLedger.vue';
import StoryWorldviewOntologyManager from './StoryWorldviewOntologyManager.vue';
import {
  createWorldviewPredicateSchemaStatements,
  getWorldviewEntities,
  groupWorldviewEntities,
  worldviewEntityDirectories,
  worldviewRoleAssetOptions,
  type WorldviewEntity,
  type WorldviewEntityType,
  type WorldviewFactStatement,
  type WorldviewPredicateDefinition,
  type WorldviewPredicateNode,
} from './story-worldview-ontology';
import { useStoryWorldviewStateRegistry } from './story-worldview-state';

type WorldviewMode = 'document' | 'ontology';

type WorldviewSection = {
  id: string;
  label: string;
};

type WorldviewSectionGroup = {
  id: string;
  label: string;
  sections: WorldviewSection[];
};

const sectionGroups = reactive<WorldviewSectionGroup[]>([
  {
    id: 'world-foundation',
    label: '世界基础',
    sections: [
      { id: 'space-time', label: '时空背景' },
      { id: 'society', label: '社会制度' },
    ],
  },
  {
    id: 'world-system',
    label: '世界运行',
    sections: [{ id: 'rules', label: '世界规则' }],
  },
  {
    id: 'story-expression',
    label: '叙事表达',
    sections: [{ id: 'tone', label: '风格与基调' }],
  },
]);

const sections = computed(() =>
  sectionGroups.flatMap((group) => group.sections),
);

const initialContents: Record<string, string> = {
  'space-time':
    '<h2>雾城，近未来</h2><p>故事发生在一座临海城市。旧城区被高架轨道切成两半，档案馆位于两种生活交界的地方。</p><ul><li>时间：近未来，城市经历过一次大规模信息迁移。</li><li>空间：档案馆、旧港区、新城区和地下储存库。</li></ul>',
  rules:
    '<h2>世界规则</h2><p>雾城相信“被记录的事实”才是事实。任何没有进入档案系统的记忆，都只能作为个人叙述存在。</p><ul><li>每次修改档案，都会留下不可见的时间戳。</li><li>公开真相会改变相关人物在系统中的身份权重。</li><li>没有证据的记忆不能直接改变城市规则。</li></ul>',
  society:
    '<h2>谁在管理记忆</h2><p>档案管理局掌握城市的公共记忆。修复师、调查员和普通居民都依赖同一套记录系统，但他们拥有不同的查看权限。</p>',
  tone: '<h2>冷静表面下的情绪暗流</h2><p>整体基调克制、潮湿、带有调查小说的悬疑感。重要情绪不直接说破，而通过空间、物件和被删改的句子显现。</p>',
};

const route = useRoute();
const router = useRouter();
const worldviewStateRegistry = useStoryWorldviewStateRegistry();
const projectId = computed(() => String(route.params.projectId ?? ''));
const isImmersive = computed(() => route.meta.mode === 'immersive');
const localImmersiveMode = ref<WorldviewMode>('document');
const mode = computed<WorldviewMode>(() => {
  if (isImmersive.value) return localImmersiveMode.value;
  const view = String(
    route.params.worldviewView ?? route.meta.worldviewView ?? 'settings',
  );
  return view === 'composition' ? 'ontology' : 'document';
});
const worldviewBasePath = computed(
  () => `/${encodeURIComponent(projectId.value)}/worldview`,
);
const settingsPath = computed(() => `${worldviewBasePath.value}/settings`);
const compositionPath = computed(
  () => `${worldviewBasePath.value}/composition`,
);
const currentSectionId = ref('space-time');
const expandedSectionGroups = reactive<Record<string, boolean>>(
  Object.fromEntries(sectionGroups.map((group) => [group.id, true])),
);
const expandedEntityGroups = reactive<Record<string, boolean>>(
  Object.fromEntries(
    worldviewEntityDirectories.map((group) => [group.id, true]),
  ),
);
const editorContents = reactive({ ...initialContents });
const editorStatus = ref('已保存到当前原型');
const editorElement = ref<HTMLElement | null>(null);
const knowledgeGraph = worldviewStateRegistry.getGraph(projectId.value);
const selectedEntityId = ref<string | null>(null);
const editingEntityId = ref<string | null>(null);
const showOntologyManager = ref(false);
const graphStatus = ref('统一知识图已保存到当前原型');

const currentSection = computed(
  () =>
    sections.value.find((section) => section.id === currentSectionId.value) ??
    sections.value[0],
);
const entities = computed(() => getWorldviewEntities(knowledgeGraph));
const worldviewEntityGroups = computed(() =>
  groupWorldviewEntities(entities.value),
);
const selectedEntity = computed(() =>
  selectedEntityId.value
    ? entities.value.find((entity) => entity.id === selectedEntityId.value)
    : undefined,
);
const editingEntity = computed(() =>
  editingEntityId.value
    ? entities.value.find((entity) => entity.id === editingEntityId.value)
    : undefined,
);
function selectSection(sectionId: string) {
  currentSectionId.value = sectionId;
  editorStatus.value = '已切换设定章节';
}

function toggleSectionGroup(groupId: string) {
  expandedSectionGroups[groupId] = !expandedSectionGroups[groupId];
}

function toggleEntityGroup(groupId: string) {
  expandedEntityGroups[groupId] = !expandedEntityGroups[groupId];
}

function handleEditorInput(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  editorContents[currentSectionId.value] = target.innerHTML;
  editorStatus.value = '正在编辑 · 尚未连接服务器';
}

function formatEditor(command: string, value?: string) {
  editorElement.value?.focus();
  document.execCommand(command, false, value);
  editorStatus.value = '已更新当前段落';
}

function selectEntity(entityId: string | null) {
  selectedEntityId.value = entityId;
  graphStatus.value = entityId
    ? `已筛选「${entities.value.find((entity) => entity.id === entityId)?.name ?? '未知实体'}」的事实`
    : '已恢复全部世界事实';
}

function editEntity(entityId: string) {
  if (isImmersive.value) {
    selectedEntityId.value = entityId;
    editingEntityId.value = entityId;
    graphStatus.value = '正在编辑实体属性';
    return;
  }
  void router.push(
    `${compositionPath.value}/${encodeURIComponent(entityId)}/edit`,
  );
}

function closeEntityEditor() {
  editingEntityId.value = null;
  graphStatus.value = selectedEntity.value
    ? `已筛选「${selectedEntity.value.name}」的事实`
    : '统一知识图已保存到当前原型';
}

function openOntologyManager() {
  showOntologyManager.value = true;
  graphStatus.value = '正在管理 Ontology 关系类型';
}

function closeOntologyManager() {
  showOntologyManager.value = false;
  graphStatus.value = selectedEntity.value
    ? `已筛选「${selectedEntity.value.name}」的事实`
    : '统一知识图已保存到当前原型';
}

function addWorldviewEntity(type: WorldviewEntityType, groupId: string) {
  const entity = worldviewStateRegistry.createEntity(
    projectId.value,
    type,
    groupId,
  );
  expandedEntityGroups[groupId] = true;
  selectedEntityId.value = entity.id;
  editEntity(entity.id);
}

function markGraphDirty() {
  graphStatus.value = '正在编辑 · 尚未保存';
}

function saveWorldviewEntity(entity: WorldviewEntity) {
  if (!worldviewStateRegistry.saveEntity(projectId.value, entity)) {
    graphStatus.value = '保存失败：实体已经不存在';
    return;
  }
  graphStatus.value = '实体属性已保存到统一知识图';
}

function deleteEditingEntity() {
  const entity = editingEntity.value;
  if (!entity) return;
  const result = worldviewStateRegistry.deleteEntity(
    projectId.value,
    entity.id,
  );
  if (!result.deleted) {
    graphStatus.value = result.references.length
      ? `无法删除：请先处理${result.references.join('、')}`
      : '删除失败：实体已经不存在';
    return;
  }
  if (selectedEntityId.value === entity.id) selectedEntityId.value = null;
  editingEntityId.value = null;
  graphStatus.value = `已删除${entity.type}「${entity.name}」`;
}

function selectImmersiveMode(nextMode: WorldviewMode) {
  localImmersiveMode.value = nextMode;
}

function saveFact(fact: WorldviewFactStatement) {
  const index = knowledgeGraph.statements.findIndex(
    (statement) => statement.kind === 'fact' && statement.id === fact.id,
  );
  if (index >= 0) knowledgeGraph.statements.splice(index, 1, fact);
  else knowledgeGraph.statements.push(fact);
  graphStatus.value = '事实关系已保存到统一知识图';
}

function deleteFact(factId: string) {
  const index = knowledgeGraph.statements.findIndex(
    (statement) => statement.kind === 'fact' && statement.id === factId,
  );
  if (index < 0) return;
  knowledgeGraph.statements.splice(index, 1);
  graphStatus.value = '事实关系已从统一知识图移除';
}

function savePredicateDefinition(definition: WorldviewPredicateDefinition) {
  const nodeIndex = knowledgeGraph.nodes.findIndex(
    (node) => node.kind === 'predicate' && node.id === definition.predicate.id,
  );
  if (nodeIndex >= 0) {
    knowledgeGraph.nodes.splice(nodeIndex, 1, definition.predicate);
  } else {
    knowledgeGraph.nodes.push(definition.predicate);
  }

  for (
    let index = knowledgeGraph.statements.length - 1;
    index >= 0;
    index -= 1
  ) {
    const statement = knowledgeGraph.statements[index];
    if (
      statement?.kind === 'schema' &&
      statement.subjectId === definition.predicate.id
    ) {
      knowledgeGraph.statements.splice(index, 1);
    }
  }
  knowledgeGraph.statements.push(
    ...createWorldviewPredicateSchemaStatements(definition),
  );
  graphStatus.value = `Ontology 已保存关系类型「${definition.predicate.label}」`;
}

function togglePredicate(predicateId: string) {
  const predicate = knowledgeGraph.nodes.find(
    (node): node is WorldviewPredicateNode =>
      node.kind === 'predicate' && node.id === predicateId,
  );
  if (!predicate || predicate.scope !== 'project') return;
  predicate.status = predicate.status === 'active' ? 'inactive' : 'active';
  graphStatus.value = `已${predicate.status === 'active' ? '启用' : '停用'}关系类型「${predicate.label}」`;
}
</script>

<template>
  <section class="story-worldview-workspace" aria-label="世界观工作区">
    <div
      class="story-worldview-mode-tabs"
      role="tablist"
      aria-label="世界观工作区"
    >
      <template v-if="!isImmersive">
        <RouterLink
          class="story-worldview-mode-tab"
          :class="{ 'is-active': mode === 'document' }"
          :to="settingsPath"
          role="tab"
          :aria-selected="mode === 'document'"
        >
          <strong>设定文档</strong>
          <span>用文字建立世界的边界</span>
        </RouterLink>
        <RouterLink
          class="story-worldview-mode-tab"
          :class="{ 'is-active': mode === 'ontology' }"
          :to="compositionPath"
          role="tab"
          :aria-selected="mode === 'ontology'"
        >
          <strong>世界构成</strong>
          <span>用事实关系描述实体之间如何连接</span>
        </RouterLink>
      </template>
      <template v-else>
        <button
          class="story-worldview-mode-tab"
          :class="{ 'is-active': mode === 'document' }"
          type="button"
          role="tab"
          :aria-selected="mode === 'document'"
          @click="selectImmersiveMode('document')"
        >
          <strong>设定文档</strong>
          <span>用文字建立世界的边界</span>
        </button>
        <button
          class="story-worldview-mode-tab"
          :class="{ 'is-active': mode === 'ontology' }"
          type="button"
          role="tab"
          :aria-selected="mode === 'ontology'"
          @click="selectImmersiveMode('ontology')"
        >
          <strong>世界构成</strong>
          <span>用事实关系描述实体之间如何连接</span>
        </button>
      </template>
    </div>

    <div v-if="mode === 'document'" class="story-worldview-document-layout">
      <aside class="story-worldview-toc" aria-label="设定目录">
        <div class="story-worldview-toc-header">
          <span class="story-worldview-label">设定目录</span>
        </div>
        <button class="story-worldview-toc-create" type="button">
          新增设定
        </button>
        <nav class="story-worldview-toc-tree">
          <div
            v-for="group in sectionGroups"
            :key="group.id"
            class="story-worldview-toc-group"
          >
            <button
              class="story-worldview-toc-group-toggle"
              :class="{ 'is-expanded': expandedSectionGroups[group.id] }"
              type="button"
              :aria-expanded="expandedSectionGroups[group.id]"
              :aria-controls="`story-worldview-group-${group.id}`"
              :aria-label="`${expandedSectionGroups[group.id] ? '收起' : '展开'}${group.label}`"
              @click="toggleSectionGroup(group.id)"
            >
              <svg
                class="story-worldview-toc-chevron"
                viewBox="0 0 12 12"
                aria-hidden="true"
              >
                <path d="m4 2.5 3.5 3.5L4 9.5" />
              </svg>
              <strong>{{ group.label }}</strong>
              <span class="story-worldview-toc-group-add" aria-hidden="true"
                >+</span
              >
            </button>

            <div
              v-show="expandedSectionGroups[group.id]"
              :id="`story-worldview-group-${group.id}`"
              class="story-worldview-toc-children"
            >
              <button
                v-for="section in group.sections"
                :key="section.id"
                class="story-worldview-toc-item"
                :class="{ 'is-active': currentSectionId === section.id }"
                type="button"
                :aria-current="
                  currentSectionId === section.id ? 'page' : undefined
                "
                @click="selectSection(section.id)"
              >
                <span class="story-worldview-toc-item-label">
                  <strong>{{ section.label }}</strong>
                </span>
                <span class="story-worldview-toc-delete" aria-hidden="true">
                  <svg viewBox="0 0 12 12">
                    <path
                      d="M3.5 4.5v4.3c0 .7.4 1.1 1.1 1.1h2.8c.7 0 1.1-.4 1.1-1.1V4.5M2.5 4.5h7M4.2 2.8h3.6l.5 1.7H3.7l.5-1.7Z"
                    />
                  </svg>
                </span>
              </button>
            </div>
          </div>
        </nav>
      </aside>

      <article class="story-worldview-editor-panel" aria-label="设定文档编辑器">
        <div
          class="story-worldview-editor-toolbar"
          role="toolbar"
          aria-label="富文本工具栏"
        >
          <button
            type="button"
            title="加粗"
            aria-label="加粗"
            @click="formatEditor('bold')"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            title="斜体"
            aria-label="斜体"
            @click="formatEditor('italic')"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            title="二级标题"
            aria-label="二级标题"
            @click="formatEditor('formatBlock', '<h2>')"
          >
            H2
          </button>
          <button
            type="button"
            title="项目列表"
            aria-label="项目列表"
            @click="formatEditor('insertUnorderedList')"
          >
            • —
          </button>
          <button
            type="button"
            title="引用"
            aria-label="引用"
            @click="formatEditor('formatBlock', '<blockquote>')"
          >
            “ ”
          </button>
        </div>

        <div
          ref="editorElement"
          :key="currentSectionId"
          class="story-worldview-rich-editor"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          :aria-label="`${currentSection.label}富文本编辑区`"
          spellcheck="true"
          v-html="editorContents[currentSectionId]"
          @input="handleEditorInput"
        ></div>
      </article>
    </div>

    <div v-else class="story-worldview-ontology-layout">
      <section class="story-worldview-entities-panel" aria-label="世界要素目录">
        <header class="story-worldview-panel-header">
          <div>
            <span class="story-worldview-label">世界构成 / 实体目录</span>
          </div>
          <button
            v-if="selectedEntityId"
            class="story-worldview-directory-clear"
            type="button"
            @click="selectEntity(null)"
          >
            清除筛选
          </button>
        </header>

        <nav class="story-worldview-toc-tree" aria-label="世界要素目录">
          <div
            v-for="group in worldviewEntityGroups"
            :key="group.id"
            class="story-worldview-toc-group"
          >
            <div class="story-worldview-entity-group-header">
              <button
                class="story-worldview-toc-group-toggle"
                :class="{ 'is-expanded': expandedEntityGroups[group.id] }"
                type="button"
                :aria-expanded="expandedEntityGroups[group.id]"
                :aria-controls="`story-worldview-entity-group-${group.id}`"
                :aria-label="`${expandedEntityGroups[group.id] ? '收起' : '展开'}${group.label}`"
                @click="toggleEntityGroup(group.id)"
              >
                <svg
                  class="story-worldview-toc-chevron"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                >
                  <path d="m4 2.5 3.5 3.5L4 9.5" />
                </svg>
                <strong>{{ group.label }}</strong>
              </button>
              <button
                class="story-worldview-toc-group-add"
                type="button"
                :aria-label="`新增${group.label}`"
                @click="addWorldviewEntity(group.label, group.id)"
              >
                +
              </button>
            </div>

            <div
              v-show="expandedEntityGroups[group.id]"
              :id="`story-worldview-entity-group-${group.id}`"
              class="story-worldview-toc-children"
            >
              <div
                v-for="entity in group.entities"
                :key="entity.id"
                class="story-worldview-entity-row"
              >
                <button
                  class="story-worldview-toc-item"
                  :class="{ 'is-active': selectedEntityId === entity.id }"
                  type="button"
                  :aria-current="
                    selectedEntityId === entity.id ? 'page' : undefined
                  "
                  @click="selectEntity(entity.id)"
                >
                  <span class="story-worldview-toc-item-label">
                    <strong>{{ entity.name }}</strong>
                  </span>
                </button>
                <button
                  class="story-worldview-entity-edit"
                  type="button"
                  :aria-label="`编辑${entity.name}属性`"
                  @click="editEntity(entity.id)"
                >
                  编辑
                </button>
              </div>
            </div>
          </div>
        </nav>
      </section>

      <section
        class="story-worldview-relations-panel story-worldview-facts-panel"
        aria-labelledby="story-worldview-facts-title"
      >
        <header
          class="story-worldview-panel-header story-worldview-structure-header"
        >
          <div>
            <span class="story-worldview-label">世界构成 / 统一知识图</span>
            <h3 id="story-worldview-facts-title">世界事实</h3>
          </div>
          <div class="story-worldview-fact-actions">
            <button
              v-if="selectedEntity"
              type="button"
              @click="editEntity(selectedEntity.id)"
            >
              编辑实体属性
            </button>
            <button type="button" @click="openOntologyManager">
              Ontology 管理
            </button>
          </div>
        </header>

        <StoryWorldviewFactGraph
          :state="knowledgeGraph"
          :selected-entity-id="selectedEntityId"
          @select-entity="selectEntity"
        />
        <StoryWorldviewFactLedger
          :state="knowledgeGraph"
          :selected-entity-id="selectedEntityId"
          :status="graphStatus"
          @clear-filter="selectEntity(null)"
          @delete-fact="deleteFact"
          @dirty="markGraphDirty"
          @save-fact="saveFact"
        />
      </section>
    </div>

    <StoryWorldviewEntityDrawer
      v-if="isImmersive && editingEntity"
      :entity="editingEntity"
      :entities="entities"
      :role-assets="worldviewRoleAssetOptions"
      :status="graphStatus"
      @close="closeEntityEditor"
      @delete="deleteEditingEntity"
      @dirty="markGraphDirty"
      @save="saveWorldviewEntity"
    />

    <StoryWorldviewOntologyManager
      v-if="showOntologyManager"
      :state="knowledgeGraph"
      :status="graphStatus"
      @close="closeOntologyManager"
      @dirty="markGraphDirty"
      @save-definition="savePredicateDefinition"
      @toggle-predicate="togglePredicate"
    />
  </section>
</template>
