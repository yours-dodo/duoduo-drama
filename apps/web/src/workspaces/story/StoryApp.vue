<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ApiError } from '../../lib/server-api/api-error';
import {
  getSession,
  type SessionSnapshot,
} from '../../lib/server-api/session-api';
import {
  confirmStoryDraft,
  createStoryProject,
  discardStoryDraft,
  editStoryDraft,
  getStoryArtifact,
  getStoryProject,
  listStoryArtifacts,
  type StoryArtifact,
  type StoryArtifactContentFormat,
  type StoryArtifactVersion,
  type StoryProject,
} from './story-api';
import StoryStatusBar from './components/StoryStatusBar.vue';

const props = defineProps<{
  projectId?: string;
}>();

const session = ref<SessionSnapshot | null>(null);
const projects = ref<StoryProject[]>([]);
const project = ref<StoryProject | null>(null);
const artifacts = ref<StoryArtifact[]>([]);
const selectedArtifact = ref<StoryArtifact | null>(null);
const selectedVersion = ref<StoryArtifactVersion | null>(null);
const draftContent = ref('');
const draftFormat = ref<StoryArtifactContentFormat>('text');
const newProjectTitle = ref('');
const selectedTeamId = ref<string | null>(null);
const viewState = ref<'loading' | 'ready' | 'error' | 'auth-required'>(
  'loading',
);
const errorMessage = ref('');
const actionMessage = ref('');
const creating = ref(false);
const saving = ref(false);
const confirming = ref(false);
const discarding = ref(false);
type WorkFilter = 'all' | 'active' | 'archived';

const workFilter = ref<WorkFilter>('all');
const workFilters: Array<{ value: WorkFilter; label: string }> = [
  { value: 'all', label: '全部作品' },
  { value: 'active', label: '创作中' },
  { value: 'archived', label: '已归档' },
];
const placeholderWorks = [
  {
    title: '雨停之前',
    type: '故事项目',
    status: 'active' as const,
    statusLabel: '创作中',
    updated: '刚刚更新',
    meta: '03 个成果 · 第 4 次更新',
    mark: '01',
  },
  {
    title: '无声电台',
    type: '故事项目',
    status: 'active' as const,
    statusLabel: '创作中',
    updated: '昨天更新',
    meta: '05 个成果 · 第 8 次更新',
    mark: '02',
  },
  {
    title: '潮汐之后',
    type: '故事项目',
    status: 'archived' as const,
    statusLabel: '已归档',
    updated: '6 月 18 日',
    meta: '08 个成果 · 第 12 次更新',
    mark: '03',
  },
  {
    title: '明天的旧照片',
    type: '故事项目',
    status: 'active' as const,
    statusLabel: '创作中',
    updated: '6 月 16 日',
    meta: '02 个成果 · 第 2 次更新',
    mark: '04',
  },
] as const;

const activeTeam = computed(
  () =>
    session.value?.teams.find((team) => team.id === selectedTeamId.value) ??
    null,
);
const canEdit = computed(
  () =>
    project.value?.canEdit === true &&
    selectedVersion.value?.status === 'draft',
);
const projectMode = computed(() => (props.projectId ? 'project' : 'catalog'));
const visiblePlaceholderWorks = computed(() =>
  workFilter.value === 'all'
    ? placeholderWorks
    : placeholderWorks.filter((work) => work.status === workFilter.value),
);
const statusBarMessage = computed(() => {
  if (viewState.value === 'loading') return '读取中…';
  if (viewState.value === 'error') return '需要处理';
  if (saving.value || confirming.value || discarding.value) return '同步中…';
  if (actionMessage.value) return '已同步';
  return project.value ? '已连接' : '等待选择项目';
});

const artifactTypeLabels: Record<StoryArtifact['type'], string> = {
  idea: '灵感',
  world_setting: '世界观',
  character: '人物',
  outline: '大纲',
  script: '剧本',
};

const versionStatusLabels: Record<StoryArtifactVersion['status'], string> = {
  draft: '待确认',
  confirmed: '已确认',
  discarded: '已丢弃',
};

onMounted(loadWorkspace);

async function loadWorkspace() {
  viewState.value = 'loading';
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    session.value = await getSession();
    selectedTeamId.value ??= session.value.teams[0]?.id ?? null;
    if (selectedTeamId.value === null) {
      projects.value = [];
      project.value = null;
      artifacts.value = [];
      viewState.value = 'ready';
      return;
    }

    if (props.projectId) {
      await loadProject(selectedTeamId.value, props.projectId);
    } else {
      viewState.value = 'ready';
    }
  } catch (error) {
    handleError(error);
  }
}

async function loadProject(teamId: string, projectId: string) {
  const [{ project: loadedProject }, { items }] = await Promise.all([
    getStoryProject(teamId, projectId),
    listStoryArtifacts(teamId, projectId),
  ]);
  project.value = loadedProject;
  projects.value = [loadedProject];
  artifacts.value = items;
  selectedArtifact.value = items[0] ?? null;
  selectedVersion.value = null;
  draftContent.value = '';
  if (selectedArtifact.value) {
    await loadArtifact(teamId, projectId, selectedArtifact.value.id);
  }
  viewState.value = 'ready';
}

async function loadArtifact(
  teamId: string,
  projectId: string,
  artifactId: string,
) {
  const result = await getStoryArtifact(teamId, projectId, artifactId);
  selectedArtifact.value = result.artifact;
  selectedVersion.value = result.currentVersion;
  draftContent.value = result.currentVersion?.content ?? '';
  draftFormat.value = result.currentVersion?.contentFormat ?? 'text';
}

async function selectArtifact(artifact: StoryArtifact) {
  if (!activeTeam.value || !project.value) return;
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    await loadArtifact(activeTeam.value.id, project.value.id, artifact.id);
  } catch (error) {
    handleError(error);
  }
}

async function createProject() {
  if (!activeTeam.value || !newProjectTitle.value.trim()) return;
  creating.value = true;
  errorMessage.value = '';
  try {
    const result = await createStoryProject(activeTeam.value.id, {
      title: newProjectTitle.value.trim(),
    });
    window.location.assign(`/stories/${result.project.id}`);
  } catch (error) {
    handleError(error);
  } finally {
    creating.value = false;
  }
}

async function saveDraft() {
  if (
    !activeTeam.value ||
    !project.value ||
    !selectedArtifact.value ||
    !selectedVersion.value
  )
    return;
  saving.value = true;
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    const result = await editStoryDraft(
      activeTeam.value.id,
      project.value.id,
      selectedArtifact.value.id,
      selectedVersion.value.id,
      {
        content: draftContent.value,
        contentFormat: draftFormat.value,
        expectedVersionNumber: selectedVersion.value.versionNumber,
      },
    );
    project.value = { ...project.value, updatedAt: new Date().toISOString() };
    selectedArtifact.value = result.artifact;
    selectedVersion.value = result.version;
    draftContent.value = result.version.content;
    actionMessage.value = '已保存为新的草稿版本。';
  } catch (error) {
    handleError(error);
  } finally {
    saving.value = false;
  }
}

async function confirmDraft() {
  if (
    !activeTeam.value ||
    !project.value ||
    !selectedArtifact.value ||
    !selectedVersion.value
  )
    return;
  confirming.value = true;
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    const result = await confirmStoryDraft(
      activeTeam.value.id,
      project.value.id,
      selectedArtifact.value.id,
      selectedVersion.value.id,
      selectedVersion.value.versionNumber,
    );
    selectedArtifact.value = result.artifact;
    selectedVersion.value = result.version;
    draftContent.value = result.version.content;
    actionMessage.value = '这个版本已成为当前确认成果。';
  } catch (error) {
    handleError(error);
  } finally {
    confirming.value = false;
  }
}

async function discardDraft() {
  if (
    !activeTeam.value ||
    !project.value ||
    !selectedArtifact.value ||
    !selectedVersion.value
  )
    return;
  discarding.value = true;
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    const result = await discardStoryDraft(
      activeTeam.value.id,
      project.value.id,
      selectedArtifact.value.id,
      selectedVersion.value.id,
      selectedVersion.value.versionNumber,
    );
    selectedArtifact.value = result.artifact;
    await loadArtifact(
      activeTeam.value.id,
      project.value.id,
      selectedArtifact.value.id,
    );
    actionMessage.value = '草稿已丢弃，当前成果已回到上一个确认版本。';
  } catch (error) {
    handleError(error);
  } finally {
    discarding.value = false;
  }
}

function handleError(error: unknown) {
  if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') {
    viewState.value = 'auth-required';
    errorMessage.value = '登录状态已失效，请重新登录后继续。';
    return;
  }
  viewState.value = 'error';
  errorMessage.value =
    error instanceof Error ? error.message : '故事工作台暂时无法加载。';
}

function formatDate(value: string | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
</script>

<template>
  <section
    class="workspace-shell story-workspace story-workbench"
    aria-labelledby="story-workspace-title"
  >
    <header
      v-if="projectMode === 'project'"
      class="workspace-shell-header story-workbench-header"
    >
      <div>
        <p class="eyebrow">Story Studio / 01</p>
        <h1 id="story-workspace-title">故事创作</h1>
        <p class="workspace-subtitle">
          {{
            project ? project.title : '先把故事放在桌面上，再决定它要走向哪里。'
          }}
        </p>
      </div>
      <div class="story-header-actions">
        <span v-if="activeTeam" class="team-chip">{{ activeTeam.name }}</span>
        <a class="text-link" href="/workspace">切换工作台 ↗</a>
      </div>
    </header>

    <div
      v-if="viewState === 'loading'"
      class="workspace-state workspace-state-loading"
      role="status"
    >
      <span class="state-mark" aria-hidden="true">✦</span>
      <strong>正在铺开你的故事桌面</strong>
      <span>读取项目与已确认成果……</span>
    </div>

    <div
      v-else-if="viewState === 'auth-required'"
      class="workspace-state"
      role="alert"
    >
      <span class="state-mark" aria-hidden="true">↗</span>
      <strong>{{ errorMessage }}</strong>
      <a class="button button-primary" href="/login">去登录 <span>→</span></a>
    </div>

    <div v-else-if="viewState === 'error'" class="workspace-state" role="alert">
      <span class="state-mark" aria-hidden="true">!</span>
      <strong>{{ errorMessage }}</strong>
      <button
        class="button button-primary"
        type="button"
        @click="loadWorkspace"
      >
        重新加载 <span>↻</span>
      </button>
    </div>

    <template v-else-if="projectMode === 'catalog'">
      <div class="story-catalog-layout">
        <aside class="story-floating-sidebar" aria-label="故事工作区功能导航">
          <div class="story-floating-sidebar-mark" aria-hidden="true">S</div>
          <nav class="story-floating-nav">
            <a class="story-floating-nav-item is-active" href="#story-entry-title">
              <span class="story-floating-nav-index">01</span>
              <span>创作</span>
            </a>
            <a class="story-floating-nav-item" href="#story-works">
              <span class="story-floating-nav-index">02</span>
              <span>作品</span>
            </a>
            <button class="story-floating-nav-item" type="button" disabled>
              <span class="story-floating-nav-index">03</span>
              <span>素材</span>
            </button>
            <button class="story-floating-nav-item" type="button" disabled>
              <span class="story-floating-nav-index">04</span>
              <span>协作</span>
            </button>
          </nav>
          <span class="story-floating-sidebar-note">STORY / DESK</span>
        </aside>

        <div class="story-catalog-main">
          <section class="story-entry-dialog" aria-labelledby="story-entry-title">
            <div class="story-entry-brand" aria-hidden="true">DUODUO / STORY</div>
            <div class="story-entry-copy">
              <span class="story-entry-kicker">AI 创作入口</span>
              <h1 id="story-entry-title">你想写什么？</h1>
              <p>把脑海里的第一句话交给我。</p>
            </div>

            <form class="story-entry-form" @submit.prevent="createProject">
              <label class="sr-only" for="story-entry-prompt">故事想法</label>
              <textarea
                id="story-entry-prompt"
                v-model="newProjectTitle"
                autofocus
                rows="4"
                maxlength="200"
                placeholder="比如：一个失去记忆的女孩，每晚都会收到来自未来的语音……"
                :disabled="creating || !activeTeam"
                @keydown.enter.meta.prevent="createProject"
                @keydown.enter.ctrl.prevent="createProject"
              ></textarea>
              <div class="story-entry-form-footer">
                <span>{{
                  activeTeam ? '按 ⌘ Enter 开始' : '当前账号还没有可用的团队空间'
                }}</span>
                <button
                  class="story-entry-submit"
                  type="submit"
                  :disabled="creating || !activeTeam || !newProjectTitle.trim()"
                  :aria-label="creating ? '正在创建故事' : '开始创作'"
                >
                  <span>{{ creating ? '创建中…' : '开始' }}</span>
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
            </form>

            <p v-if="errorMessage" class="story-entry-error" role="alert">
              {{ errorMessage }}
            </p>
          </section>

          <section
            id="story-works"
            class="story-works-region"
            aria-labelledby="story-works-title"
          >
            <header class="story-works-header">
              <div>
                <span class="story-entry-kicker">MY WORKS / 02</span>
                <h2 id="story-works-title">我的作品</h2>
                <p>把已经发生的创作收在这里，继续下一次推进。</p>
              </div>
              <label class="story-space-switcher">
                <span>当前空间</span>
                <select v-model="selectedTeamId" aria-label="切换空间">
                  <option
                    v-for="team in session?.teams ?? []"
                    :key="team.id"
                    :value="team.id"
                  >
                    {{ team.name }}
                  </option>
                </select>
              </label>
            </header>

            <div class="story-works-toolbar" aria-label="作品筛选">
              <div class="story-filter-list" role="group" aria-label="按状态筛选作品">
                <button
                  v-for="filter in workFilters"
                  :key="filter.value"
                  class="story-filter-button"
                  :class="{ 'is-active': workFilter === filter.value }"
                  type="button"
                  :aria-pressed="workFilter === filter.value"
                  @click="workFilter = filter.value"
                >
                  {{ filter.label }}
                </button>
              </div>
              <span class="story-works-count"
                >{{ visiblePlaceholderWorks.length }} / {{ placeholderWorks.length }} 件作品</span
              >
            </div>

            <div v-if="visiblePlaceholderWorks.length" class="story-placeholder-grid">
              <article
                v-for="work in visiblePlaceholderWorks"
                :key="work.title"
                class="story-placeholder-card"
                :class="`is-${work.status}`"
              >
                <div class="story-placeholder-card-top">
                  <span>{{ work.mark }}</span>
                  <span>{{ work.updated }}</span>
                </div>
                <div class="story-placeholder-cover" aria-hidden="true">
                  <span>{{ work.title.slice(0, 1) }}</span>
                </div>
                <div class="story-placeholder-card-body">
                  <span class="story-placeholder-type">{{ work.type }}</span>
                  <h3>{{ work.title }}</h3>
                  <p>{{ work.meta }}</p>
                </div>
                <footer class="story-placeholder-card-footer">
                  <span>{{ work.statusLabel }}</span>
                  <span aria-hidden="true">↗</span>
                </footer>
              </article>
            </div>
            <div v-else class="story-works-empty">
              <strong>还没有符合条件的作品</strong>
              <span>切换筛选条件后，作品会继续留在这里。</span>
            </div>
          </section>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="story-project-layout">
        <aside class="workspace-panel story-project-sidebar">
          <a class="back-link" href="/stories">← 全部故事</a>
          <div class="story-project-meta">
            <span class="panel-label">当前项目</span>
            <h2>{{ project?.title }}</h2>
            <span class="project-status-line"
              ><i aria-hidden="true"></i
              >{{ project?.status === 'active' ? '创作中' : '已归档' }} · 第
              {{ project?.revision }} 次更新</span
            >
          </div>
          <div class="story-sidebar-divider"></div>
          <span class="panel-label">已确认成果</span>
          <div class="sidebar-artifact-summary">
            <strong>{{
              artifacts.filter((item) => item.currentVersionId).length
            }}</strong>
            <span>/ {{ artifacts.length || 0 }} 个成果已有当前版本</span>
          </div>
          <p class="panel-footnote">
            成果版本会被单独保存。编辑不会覆盖旧版本，确认才会改变项目的当前成果。
          </p>
        </aside>

        <section
          class="workspace-panel workspace-panel-main story-artifact-panel"
        >
          <div class="panel-heading-row artifact-heading">
            <div>
              <span class="panel-label">Story artifacts</span>
              <h2>故事成果</h2>
            </div>
            <span class="artifact-heading-note">{{
              artifacts.length ? `${artifacts.length} 个成果` : '等待第一份成果'
            }}</span>
          </div>

          <div
            v-if="!artifacts.length"
            class="empty-panel empty-panel-main story-artifact-empty"
          >
            <span class="panel-icon" aria-hidden="true">✦</span>
            <strong>故事还在等待第一笔落墨</strong>
            <span
              >下一步会接入创作对话。对话生成的成果将在这里出现，并由你决定哪些版本值得留下。</span
            >
            <button type="button" disabled>开始创作对话</button>
          </div>

          <div v-else class="artifact-workbench">
            <div class="artifact-list" aria-label="故事成果列表">
              <button
                v-for="artifact in artifacts"
                :key="artifact.id"
                class="artifact-list-item"
                :class="{
                  'artifact-list-item-active':
                    selectedArtifact?.id === artifact.id,
                }"
                type="button"
                @click="selectArtifact(artifact)"
              >
                <span class="artifact-type-mark">{{
                  artifactTypeLabels[artifact.type].slice(0, 1)
                }}</span>
                <span class="artifact-list-copy">
                  <strong>{{ artifact.title }}</strong>
                  <small
                    >{{ artifactTypeLabels[artifact.type] }} ·
                    {{
                      artifact.currentVersionId ? '有当前版本' : '尚未确认'
                    }}</small
                  >
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </div>

            <article v-if="selectedArtifact" class="artifact-detail">
              <header class="artifact-detail-header">
                <div>
                  <span class="artifact-kicker">{{
                    artifactTypeLabels[selectedArtifact.type]
                  }}</span>
                  <h3>{{ selectedArtifact.title }}</h3>
                </div>
                <span
                  v-if="selectedVersion"
                  class="version-badge"
                  :class="`version-badge-${selectedVersion.status}`"
                >
                  v{{ selectedVersion.versionNumber }} ·
                  {{ versionStatusLabels[selectedVersion.status] }}
                </span>
              </header>
              <div v-if="selectedVersion" class="artifact-editor">
                <textarea
                  v-model="draftContent"
                  :readonly="!canEdit"
                  aria-label="故事成果内容"
                ></textarea>
                <div class="artifact-editor-footer">
                  <span
                    >{{
                      selectedVersion.sourceType === 'agent'
                        ? '由 Agent 生成'
                        : '由创作者编辑'
                    }}
                    · {{ formatDate(selectedVersion.createdAt) }}</span
                  >
                  <select
                    v-if="canEdit"
                    v-model="draftFormat"
                    aria-label="内容格式"
                  >
                    <option value="text">纯文本</option>
                    <option value="markdown">Markdown</option>
                  </select>
                </div>
              </div>
              <div v-else class="artifact-no-version">
                <span class="panel-icon" aria-hidden="true">○</span>
                <strong>这个成果还没有可查看的版本</strong>
                <span>它会在故事对话产出第一版内容后出现在这里。</span>
              </div>
              <div
                v-if="selectedVersion?.status === 'draft'"
                class="artifact-actions"
              >
                <button
                  class="button button-primary"
                  type="button"
                  :disabled="
                    saving || confirming || discarding || !draftContent.trim()
                  "
                  @click="saveDraft"
                >
                  {{ saving ? '保存中…' : '保存为新版本' }} <span>↗</span>
                </button>
                <button
                  class="button button-quiet"
                  type="button"
                  :disabled="saving || confirming || discarding"
                  @click="confirmDraft"
                >
                  {{ confirming ? '确认中…' : '确认这版' }}
                </button>
                <button
                  class="text-button-danger"
                  type="button"
                  :disabled="saving || confirming || discarding"
                  @click="discardDraft"
                >
                  {{ discarding ? '丢弃中…' : '丢弃草稿' }}
                </button>
              </div>
              <p v-if="actionMessage" class="action-message" role="status">
                {{ actionMessage }}
              </p>
              <p
                v-if="selectedVersion?.status === 'confirmed'"
                class="confirmed-note"
              >
                这是当前确认版本。需要修改时，会从它创建新的草稿，不会覆盖这次确认。
              </p>
            </article>
          </div>
        </section>
      </div>
    </template>

    <StoryStatusBar
      v-if="projectMode === 'project'"
      :team-name="activeTeam?.name"
      :project-name="project?.title"
      :status="statusBarMessage"
    />
  </section>
</template>
