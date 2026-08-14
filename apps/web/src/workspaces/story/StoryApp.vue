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
  listStoryProjects,
  type StoryArtifact,
  type StoryArtifactContentFormat,
  type StoryArtifactVersion,
  type StoryProject,
} from './story-api';
import StoryStatusBar from './components/StoryStatusBar.vue';
import { getStoryCoverVariant, hasStoryCover } from './story-cover';

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
const failedCoverProjectIds = ref(new Set<string>());

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
    failedCoverProjectIds.value = new Set();
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
      projects.value = (await listStoryProjects(selectedTeamId.value)).items;
      viewState.value = 'ready';
    }
  } catch (error) {
    handleError(error);
  }
}

function handleCoverError(projectId: string) {
  failedCoverProjectIds.value = new Set(failedCoverProjectIds.value).add(
    projectId,
  );
}

function shouldShowCover(project: StoryProject) {
  return hasStoryCover(project) && !failedCoverProjectIds.value.has(project.id);
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
    <header class="workspace-shell-header story-workbench-header">
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
      <section class="story-library" aria-labelledby="story-library-title">
        <header class="story-library-header">
          <div>
            <span class="panel-label">我的小说</span>
            <h2 id="story-library-title">正在写的故事</h2>
            <p>从一个名字开始，把人物、世界和剧情慢慢写成一部小说。</p>
          </div>
          <span class="story-library-count">{{ projects.length }} 部作品</span>
        </header>

        <div v-if="projects.length" class="story-book-grid">
          <a
            v-for="(item, index) in projects"
            :key="item.id"
            class="story-book-card"
            :href="`/stories/${item.id}`"
            :aria-label="`打开小说：${item.title}`"
          >
            <div
              class="story-book-cover"
              :class="getStoryCoverVariant(item.id)"
            >
              <img
                v-if="shouldShowCover(item)"
                :src="item.coverUrl"
                :alt="item.title"
                @error="handleCoverError(item.id)"
              />
              <div v-else class="story-default-cover" aria-hidden="true">
                <span class="story-cover-index"
                  >STORY / {{ String(index + 1).padStart(2, '0') }}</span
                >
                <span class="story-cover-mark">✦</span>
                <span class="story-cover-code">WORK IN PROGRESS</span>
              </div>
            </div>
            <div class="story-book-info">
              <h3>{{ item.title }}</h3>
              <div class="story-book-meta">
                <span>{{
                  item.status === 'active' ? '进行中' : '已归档'
                }}</span>
                <span>{{ formatDate(item.updatedAt) }}</span>
              </div>
            </div>
          </a>
        </div>

        <div v-else class="story-library-empty">
          <span class="panel-icon" aria-hidden="true">○</span>
          <strong>还没有故事项目</strong>
          <span>先给这个想法一个名字，之后再慢慢长出人物、世界和剧本。</span>
        </div>

        <form
          v-if="activeTeam"
          class="new-project-form story-new-project-form"
          @submit.prevent="createProject"
        >
          <div>
            <label for="new-story-title">新建小说</label>
            <span>给下一个故事一个名字</span>
          </div>
          <div class="new-project-input-row">
            <input
              id="new-story-title"
              v-model="newProjectTitle"
              type="text"
              placeholder="例如：雨停之前"
              maxlength="200"
            />
            <button
              type="submit"
              :disabled="creating || !newProjectTitle.trim()"
              :aria-label="creating ? '正在创建' : '创建小说'"
            >
              {{ creating ? '…' : '+' }}
            </button>
          </div>
        </form>
        <p v-else class="panel-footnote">当前账号还没有可用的团队空间。</p>
      </section>
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
      :team-name="activeTeam?.name"
      :project-name="project?.title"
      :status="statusBarMessage"
    />
  </section>
</template>
