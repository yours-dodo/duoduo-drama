<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

type WorldviewMode = 'document' | 'ontology';

type WorldviewSection = {
  id: string;
  label: string;
  description: string;
};

type WorldviewEntity = {
  id: string;
  name: string;
  type: string;
  description: string;
};

const sections: WorldviewSection[] = [
  {
    id: 'overview',
    label: '世界概述',
    description: '一句话说明这个世界如何运转，以及故事为什么发生在这里。',
  },
  {
    id: 'space-time',
    label: '时空背景',
    description: '记录时代、地理、空间尺度和故事发生的时间窗口。',
  },
  {
    id: 'rules',
    label: '世界规则',
    description: '用叙事语言说明世界的限制、代价与不可违反的边界。',
  },
  {
    id: 'society',
    label: '社会制度',
    description: '整理组织、阶层、权力和日常生活中的运行机制。',
  },
  {
    id: 'tone',
    label: '风格与基调',
    description: '确定故事的情绪、审美、叙事速度和读者感受。',
  },
];

const initialContents: Record<string, string> = {
  overview:
    '<h2>一个被档案包围的城市</h2><p>雾城依靠旧档案维持秩序。每一份被保存的记录，都可能改变一个人的身份和一座城市的记忆。</p><p>故事从一封未寄出的信开始，沿着被替换的档案，追问谁有权决定什么应该被记住。</p>',
  'space-time':
    '<h2>雾城，近未来</h2><p>故事发生在一座临海城市。旧城区被高架轨道切成两半，档案馆位于两种生活交界的地方。</p><ul><li>时间：近未来，城市经历过一次大规模信息迁移。</li><li>空间：档案馆、旧港区、新城区和地下储存库。</li></ul>',
  rules:
    '<h2>世界规则</h2><p>雾城相信“被记录的事实”才是事实。任何没有进入档案系统的记忆，都只能作为个人叙述存在。</p><ul><li>每次修改档案，都会留下不可见的时间戳。</li><li>公开真相会改变相关人物在系统中的身份权重。</li><li>没有证据的记忆不能直接改变城市规则。</li></ul>',
  society:
    '<h2>谁在管理记忆</h2><p>档案管理局掌握城市的公共记忆。修复师、调查员和普通居民都依赖同一套记录系统，但他们拥有不同的查看权限。</p>',
  tone:
    '<h2>冷静表面下的情绪暗流</h2><p>整体基调克制、潮湿、带有调查小说的悬疑感。重要情绪不直接说破，而通过空间、物件和被删改的句子显现。</p>',
};

const entities: WorldviewEntity[] = [
  {
    id: 'fog-city',
    name: '雾城',
    type: '地点',
    description: '故事发生的临海城市，公共记忆由档案系统维持。',
  },
  {
    id: 'archive-bureau',
    name: '档案管理局',
    type: '组织',
    description: '负责保存、修复和授权城市公共档案。',
  },
  {
    id: 'lin-yao',
    name: '林遥',
    type: '角色',
    description: '地方档案馆修复师，相信证据胜过记忆。',
  },
  {
    id: 'memory-law',
    name: '记忆归档规则',
    type: '规则',
    description: '未被系统记录的记忆不能直接改变城市事实。',
  },
];

const relations = [
  { source: '林遥', relation: '工作于', target: '档案管理局', label: '角色 → 组织' },
  { source: '档案管理局', relation: '位于', target: '雾城', label: '组织 → 地点' },
  { source: '记忆归档规则', relation: '约束', target: '档案管理局', label: '规则 → 组织' },
  { source: '林遥', relation: '试图改变', target: '记忆归档规则', label: '角色 → 规则' },
];

const mode = ref<WorldviewMode>('document');
const currentSectionId = ref('overview');
const editorContents = reactive({ ...initialContents });
const editorStatus = ref('已保存到当前原型');
const editorElement = ref<HTMLElement | null>(null);
const entitySearch = ref('');
const selectedEntityId = ref('lin-yao');

const currentSection = computed(
  () => sections.find((section) => section.id === currentSectionId.value) ?? sections[0],
);
const filteredEntities = computed(() => {
  const keyword = entitySearch.value.trim().toLowerCase();
  if (!keyword) return entities;
  return entities.filter((entity) =>
    `${entity.name}${entity.type}${entity.description}`.toLowerCase().includes(keyword),
  );
});
const selectedEntity = computed(
  () => entities.find((entity) => entity.id === selectedEntityId.value) ?? entities[0],
);

function selectSection(sectionId: string) {
  currentSectionId.value = sectionId;
  editorStatus.value = '已切换设定章节';
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

function selectEntity(entityId: string) {
  selectedEntityId.value = entityId;
}
</script>

<template>
  <section class="story-worldview-workspace" aria-labelledby="story-worldview-workspace-title">
    <header class="story-worldview-header">
      <div>
        <span class="story-worldview-kicker">基础资产 / WORLDVIEW</span>
        <h2 id="story-worldview-workspace-title">世界观底稿</h2>
        <p>把世界写成可阅读的设定，也把其中的对象与关系整理成 AI 可以引用的语义基础。</p>
      </div>
    </header>

    <div class="story-worldview-mode-tabs" role="tablist" aria-label="世界观工作区">
      <button
        class="story-worldview-mode-tab"
        :class="{ 'is-active': mode === 'document' }"
        type="button"
        role="tab"
        :aria-selected="mode === 'document'"
        @click="mode = 'document'"
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
        @click="mode = 'ontology'"
      >
        <strong>世界构成</strong>
        <span>整理人物、地点与组织</span>
      </button>
    </div>

    <div v-if="mode === 'document'" class="story-worldview-document-layout">
      <aside class="story-worldview-toc" aria-label="设定文档目录">
        <div class="story-worldview-toc-header">
          <span class="story-worldview-label">文档目录</span>
          <span>05 节</span>
        </div>
        <nav>
          <button
            v-for="(section, index) in sections"
            :key="section.id"
            class="story-worldview-toc-item"
            :class="{ 'is-active': currentSectionId === section.id }"
            type="button"
            :aria-current="currentSectionId === section.id ? 'page' : undefined"
            @click="selectSection(section.id)"
          >
            <span class="story-worldview-toc-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span>
              <strong>{{ section.label }}</strong>
              <small>{{ section.description }}</small>
            </span>
          </button>
        </nav>
      </aside>

      <article class="story-worldview-editor-panel" aria-label="设定文档编辑器">
        <header class="story-worldview-editor-header">
          <div>
            <span class="story-worldview-label">设定文档 / {{ currentSection.label }}</span>
            <h3>{{ currentSection.label }}</h3>
          </div>
          <span class="story-worldview-editor-state">{{ editorStatus }}</span>
        </header>

        <div class="story-worldview-editor-toolbar" role="toolbar" aria-label="富文本工具栏">
          <button type="button" title="加粗" aria-label="加粗" @click="formatEditor('bold')"><strong>B</strong></button>
          <button type="button" title="斜体" aria-label="斜体" @click="formatEditor('italic')"><em>I</em></button>
          <button type="button" title="二级标题" aria-label="二级标题" @click="formatEditor('formatBlock', '<h2>')">H2</button>
          <button type="button" title="项目列表" aria-label="项目列表" @click="formatEditor('insertUnorderedList')">• —</button>
          <button type="button" title="引用" aria-label="引用" @click="formatEditor('formatBlock', '<blockquote>')">“ ”</button>
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

        <footer class="story-worldview-editor-footer">
          <span>富文本原型 · 内容暂存于当前页面</span>
          <span>{{ currentSection.description }}</span>
        </footer>
      </article>
    </div>

    <div v-else class="story-worldview-ontology-layout">
      <section class="story-worldview-entities-panel" aria-labelledby="story-worldview-entities-title">
        <header class="story-worldview-panel-header">
          <div>
            <span class="story-worldview-label">世界构成 / 要素</span>
            <h3 id="story-worldview-entities-title">世界要素</h3>
          </div>
          <span>{{ entities.length }} 个要素</span>
        </header>
        <label class="story-worldview-search">
          <span class="sr-only">搜索实体</span>
          <span aria-hidden="true">⌕</span>
          <input v-model="entitySearch" type="search" placeholder="搜索实体…" />
        </label>
        <div class="story-worldview-entity-list">
          <button
            v-for="entity in filteredEntities"
            :key="entity.id"
            class="story-worldview-entity-item"
            :class="{ 'is-active': selectedEntityId === entity.id }"
            type="button"
            @click="selectEntity(entity.id)"
          >
            <span class="story-worldview-entity-type">{{ entity.type }}</span>
            <strong>{{ entity.name }}</strong>
            <small>{{ entity.description }}</small>
          </button>
          <p v-if="!filteredEntities.length" class="story-worldview-empty">没有匹配的实体。</p>
        </div>
      </section>

      <section class="story-worldview-relations-panel" aria-labelledby="story-worldview-relations-title">
        <header class="story-worldview-panel-header">
          <div>
            <span class="story-worldview-label">世界构成 / 关系</span>
            <h3 id="story-worldview-relations-title">关系图</h3>
          </div>
          <span>{{ relations.length }} 条关系</span>
        </header>

        <div class="story-worldview-selected-entity">
          <span class="story-worldview-entity-type">当前要素 · {{ selectedEntity.type }}</span>
          <strong>{{ selectedEntity.name }}</strong>
          <p>{{ selectedEntity.description }}</p>
        </div>

        <div class="story-worldview-relation-list">
          <div v-for="relation in relations" :key="`${relation.source}-${relation.target}`" class="story-worldview-relation-item">
            <span>{{ relation.source }}</span>
            <strong>{{ relation.relation }}</strong>
            <span>{{ relation.target }}</span>
            <small>{{ relation.label }}</small>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
