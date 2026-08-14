<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ApiError } from '../../lib/server-api/api-error';
import {
  getSession,
  type SessionSnapshot,
} from '../../lib/server-api/session-api';
import {
  appendStoryMessage,
  confirmStoryDraft,
  createStoryConversation,
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

type StorySpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type StorySpeechRecognitionConstructor = new () => StorySpeechRecognition;

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
const selectedTeamId = ref<string | null>(null);
const viewState = ref<'loading' | 'ready' | 'error' | 'auth-required'>(
  'loading',
);
const errorMessage = ref('');
const actionMessage = ref('');
const saving = ref(false);
const confirming = ref(false);
const discarding = ref(false);
const searchQuery = ref('');
const searchDate = ref('');
const storyPrompt = ref('');
const voiceInputActive = ref(false);
const storyPromptSubmitting = ref(false);
const appliedSearch = ref({ query: '', date: '' });
let speechRecognition: StorySpeechRecognition | null = null;
const placeholderWorks = [
  {
    title: '雨停之前',
    type: '故事项目',
    updated: '刚刚更新',
    updatedAt: '2026-08-14',
  },
  {
    title: '无声电台',
    type: '故事项目',
    updated: '昨天更新',
    updatedAt: '2026-08-13',
  },
  {
    title: '潮汐之后',
    type: '故事项目',
    updated: '6 月 18 日',
    updatedAt: '2026-06-18',
  },
  {
    title: '明天的旧照片',
    type: '故事项目',
    updated: '6 月 16 日',
    updatedAt: '2026-06-16',
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
const hasAppliedWorkConditions = computed(() =>
  Boolean(appliedSearch.value.query || appliedSearch.value.date),
);
const filteredPlaceholderWorks = computed(() => {
  const { query, date } = appliedSearch.value;
  const filteredWorks = placeholderWorks.filter((work) => {
    const matchesQuery =
      !query ||
      [work.title, work.type, work.updated].some(
        (value) => value.toLocaleLowerCase().includes(query),
      );
    const matchesDate = !date || work.updatedAt === date;
    return matchesQuery && matchesDate;
  });
  return hasAppliedWorkConditions.value
    ? filteredWorks
    : [...filteredWorks].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
});
const recentPlaceholderWorkTitle = computed(() =>
  hasAppliedWorkConditions.value
    ? null
    : (filteredPlaceholderWorks.value[0]?.title ?? null),
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

function applySearch() {
  appliedSearch.value = {
    query: searchQuery.value.trim().toLocaleLowerCase(),
    date: searchDate.value,
  };
}

function createStoryTitle(prompt: string) {
  const firstThought = prompt.split(/[。！？.!?]/u)[0]?.trim() || prompt;
  const normalized = firstThought.replace(/\s+/gu, ' ');
  return normalized.length > 32
    ? `${normalized.slice(0, 32).trim()}…`
    : normalized;
}

async function submitStoryPrompt() {
  const prompt = storyPrompt.value.trim();
  if (!prompt || storyPromptSubmitting.value) return;
  if (!activeTeam.value) {
    actionMessage.value = '请先选择一个团队空间，再开始 AI 对话。';
    return;
  }

  storyPromptSubmitting.value = true;
  errorMessage.value = '';
  actionMessage.value = '';
  const title = createStoryTitle(prompt);
  try {
    const { project: createdProject } = await createStoryProject(
      activeTeam.value.id,
      { title },
    );
    const { conversation } = await createStoryConversation(
      activeTeam.value.id,
      createdProject.id,
      { title: '第一次创作对话' },
    );
    await appendStoryMessage(
      activeTeam.value.id,
      createdProject.id,
      conversation.id,
      prompt,
    );
    rememberRecentConversation({
      id: conversation.id,
      projectId: createdProject.id,
      title: conversation.title,
    });
    storyPrompt.value = '';
    window.location.assign(`/stories/${createdProject.id}`);
  } catch (error) {
    handleError(error);
  } finally {
    storyPromptSubmitting.value = false;
  }
}

function rememberRecentConversation(conversation: {
  id: string;
  projectId: string;
  title: string;
}) {
  if (typeof window === 'undefined') return;
  const storageKey = 'duoduo-story-recent-conversations';
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
    const conversations = Array.isArray(stored) ? stored : [];
    const nextConversation = {
      ...conversation,
      updatedAt: Date.now(),
    };
    const next = [
      nextConversation,
      ...conversations.filter((item) => item?.id !== conversation.id),
    ].slice(0, 5);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Recent conversations are a convenience cache; creation should still succeed.
  }
}

function toggleVoiceInput() {
  if (voiceInputActive.value) {
    speechRecognition?.stop();
    return;
  }
  if (typeof window === 'undefined') return;

  const speechWindow = window as typeof window & {
    SpeechRecognition?: StorySpeechRecognitionConstructor;
    webkitSpeechRecognition?: StorySpeechRecognitionConstructor;
  };
  const SpeechRecognition =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    const resultEvent = event as {
      resultIndex?: number;
      results: ArrayLike<ArrayLike<{ transcript: string }>>;
    };
    const transcript = Array.from(resultEvent.results)
      .slice(resultEvent.resultIndex ?? 0)
      .map((result) => result[0]?.transcript ?? '')
      .join('')
      .trim();
    if (transcript) {
      storyPrompt.value = `${storyPrompt.value.trim()} ${transcript}`.trim();
    }
  };
  recognition.onend = () => {
    voiceInputActive.value = false;
    speechRecognition = null;
  };
  recognition.onerror = () => {
    voiceInputActive.value = false;
    speechRecognition = null;
  };
  speechRecognition = recognition;
  voiceInputActive.value = true;
  try {
    recognition.start();
  } catch {
    voiceInputActive.value = false;
    speechRecognition = null;
  }
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
    :aria-labelledby="
      projectMode === 'project' ? 'story-workspace-title' : undefined
    "
    :aria-label="projectMode === 'project' ? undefined : '作品工作区'"
    :aria-busy="viewState === 'loading'"
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
      v-if="viewState === 'loading' && projectMode === 'catalog'"
      class="story-catalog-layout story-catalog-skeleton"
      role="status"
      aria-label="正在加载作品"
    >
      <span class="sr-only">正在加载作品</span>
      <div class="story-catalog-main">
        <div class="story-quick-input-group">
          <div class="story-quick-input-heading">
            <div class="story-quick-input-copy">
              <h2 class="story-quick-input-title">把一个想法变成故事</h2>
            </div>
          </div>
          <section class="story-quick-input" aria-label="新的故事想法">
            <div class="story-quick-input-control">
              <textarea
                id="story-quick-input"
                v-model="storyPrompt"
                maxlength="500"
                rows="3"
                placeholder="例如：一个失忆的急诊医生，在旧车站发现了自己的死亡证明……"
                aria-label="输入一个故事想法"
                disabled
              ></textarea>
              <button
                class="story-quick-input-send"
                type="button"
                aria-label="发送创作想法"
                title="发送创作想法"
                disabled
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  fill="none"
                >
                  <path
                    d="M10 15V5m0 0L6.5 8.5M10 5l3.5 3.5"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span class="sr-only">发送创作想法</span>
              </button>
              <button
                class="story-quick-input-voice"
                :class="{ 'is-active': voiceInputActive }"
                type="button"
                :aria-label="voiceInputActive ? '停止语音输入' : '语音输入'"
                :aria-pressed="voiceInputActive"
                :title="voiceInputActive ? '停止语音输入' : '语音输入'"
                disabled
                @click="toggleVoiceInput"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  focusable="false"
                >
                  <use
                    href="/icons/voice-regular-24.svg#voice-regular-24"
                    fill="currentColor"
                  ></use>
                </svg>
                <span class="sr-only">{{
                  voiceInputActive ? '停止语音输入' : '语音输入'
                }}</span>
              </button>
            </div>
          </section>
        </div>
        <section
          id="story-works"
          class="story-works-region"
          aria-label="作品列表"
        >
          <header class="story-works-header">
            <div class="story-works-heading">
              <div class="story-works-title-row">
                <h1 id="story-works-title">个人空间</h1>
                <label
                  v-if="session?.teams.length"
                  class="story-space-switcher"
                >
                  <span class="sr-only">切换空间</span>
                  <select disabled aria-label="切换空间">
                    <option>读取中…</option>
                  </select>
                </label>
              </div>
            </div>
          </header>

          <div class="story-works-toolbar" aria-label="作品搜索">
            <form class="story-search-form" @submit.prevent="applySearch">
              <label class="story-search-field">
                <span class="story-search-icon" aria-hidden="true">⌕</span>
                <span class="sr-only">搜索作品</span>
                <input
                  v-model="searchQuery"
                  type="search"
                  placeholder="搜索作品"
                  aria-label="搜索作品"
                  disabled
                />
              </label>
              <label class="story-date-field">
                <span class="sr-only">按日期搜索</span>
                <input
                  v-model="searchDate"
                  type="date"
                  aria-label="按日期搜索"
                  disabled
                />
              </label>
              <button
                class="story-search-button"
                type="submit"
                aria-label="搜索作品"
                title="搜索作品"
                disabled
              >
                <span class="sr-only">搜索</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                  fill="none"
                >
                  <circle
                    cx="8.5"
                    cy="8.5"
                    r="5.5"
                    stroke="currentColor"
                    stroke-width="1.6"
                  />
                  <path
                    d="m12.5 12.5 4 4"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
            </form>
          </div>

          <div class="story-placeholder-grid" aria-hidden="true">
            <article
              v-for="index in 4"
              :key="index"
              class="story-skeleton-item"
            >
              <div class="story-skeleton-card">
                <div class="story-skeleton-cover story-skeleton-shimmer"></div>
                <div class="story-skeleton-card-body">
                  <span class="story-skeleton-type story-skeleton-shimmer"></span>
                  <span
                    class="story-skeleton-card-meta story-skeleton-shimmer"
                  ></span>
                </div>
              </div>
              <span
                class="story-skeleton-title story-skeleton-shimmer"
              ></span>
            </article>
          </div>
        </section>
      </div>
    </div>

    <div
      v-else-if="viewState === 'loading'"
      class="workspace-state workspace-state-loading"
      role="status"
    >
      <span class="state-mark" aria-hidden="true">✦</span>
      <strong>正在加载故事工作区</strong>
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
        <div class="story-catalog-main">
          <div class="story-quick-input-group">
            <div class="story-quick-input-heading">
              <div class="story-quick-input-copy">
                <h2 class="story-quick-input-title">把一个想法变成故事</h2>
              </div>
            </div>
            <section class="story-quick-input" aria-label="新的故事想法">
              <div class="story-quick-input-control">
                <textarea
                  id="story-quick-input"
                  v-model="storyPrompt"
                  maxlength="500"
                  rows="3"
                  placeholder="例如：一个失忆的急诊医生，在旧火车站发现了自己的死亡证明……"
                  aria-label="输入一个故事想法"
                  :disabled="storyPromptSubmitting"
                  @keydown.enter.exact.prevent="submitStoryPrompt"
                ></textarea>
                <button
                  class="story-quick-input-send"
                  type="button"
                  :aria-label="
                    storyPromptSubmitting ? '正在准备故事' : '发送创作想法'
                  "
                  :title="
                    storyPromptSubmitting ? '正在准备故事' : '发送创作想法'
                  "
                  :disabled="
                    !storyPrompt.trim() || storyPromptSubmitting || !activeTeam
                  "
                  @click="submitStoryPrompt"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    width="18"
                    height="18"
                    fill="none"
                  >
                    <path
                      d="M10 15V5m0 0L6.5 8.5M10 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="sr-only">发送创作想法</span>
                </button>
                <button
                  class="story-quick-input-voice"
                  :class="{ 'is-active': voiceInputActive }"
                  type="button"
                  :aria-label="voiceInputActive ? '停止语音输入' : '语音输入'"
                  :aria-pressed="voiceInputActive"
                  :title="voiceInputActive ? '停止语音输入' : '语音输入'"
                  :disabled="storyPromptSubmitting"
                  @click="toggleVoiceInput"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    focusable="false"
                  >
                    <use
                      href="/icons/voice-regular-24.svg#voice-regular-24"
                      fill="currentColor"
                    ></use>
                  </svg>
                  <span class="sr-only">{{
                    voiceInputActive ? '停止语音输入' : '语音输入'
                  }}</span>
                </button>
              </div>
              <p
                v-if="storyPromptSubmitting"
                class="story-quick-input-status"
                role="status"
              >
                正在准备你的故事……
              </p>
            </section>
          </div>
          <section
            id="story-works"
            class="story-works-region"
            aria-label="作品列表"
          >
            <header class="story-works-header">
              <div class="story-works-heading">
                <div class="story-works-title-row">
                  <h1 id="story-works-title">个人空间</h1>
                  <label
                    v-if="session?.teams.length"
                    class="story-space-switcher"
                  >
                    <span class="sr-only">切换空间</span>
                    <select
                      v-model="selectedTeamId"
                      aria-label="切换空间"
                      :disabled="storyPromptSubmitting"
                    >
                      <option
                        v-if="!(session?.teams.length ?? 0)"
                        :value="null"
                      >
                        个人空间
                      </option>
                      <option
                        v-for="team in session?.teams ?? []"
                        :key="team.id"
                        :value="team.id"
                      >
                        {{ team.name }}
                      </option>
                    </select>
                  </label>
                </div>
                <p>按空间整理你的故事资产。</p>
              </div>
            </header>

            <div class="story-works-toolbar" aria-label="作品搜索">
              <form class="story-search-form" @submit.prevent="applySearch">
                <label class="story-search-field">
                  <span class="story-search-icon" aria-hidden="true">⌕</span>
                  <span class="sr-only">搜索作品</span>
                  <input
                    v-model="searchQuery"
                    type="search"
                    placeholder="搜索作品"
                    aria-label="搜索作品"
                  />
                </label>
                <label class="story-date-field">
                  <span class="sr-only">按日期搜索</span>
                  <input
                    v-model="searchDate"
                    type="date"
                    aria-label="按日期搜索"
                  />
                </label>
                <button
                  class="story-search-button"
                  type="submit"
                  aria-label="搜索作品"
                  title="搜索作品"
                >
                  <span class="sr-only">搜索</span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    width="16"
                    height="16"
                    fill="none"
                  >
                    <circle
                      cx="8.5"
                      cy="8.5"
                      r="5.5"
                      stroke="currentColor"
                      stroke-width="1.6"
                    />
                    <path
                      d="m12.5 12.5 4 4"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </form>
            </div>

            <div
              v-if="filteredPlaceholderWorks.length"
              class="story-placeholder-grid"
            >
              <article
                v-for="work in filteredPlaceholderWorks"
                :key="work.title"
                class="story-placeholder-item"
              >
                <div class="story-placeholder-card">
                  <div class="story-placeholder-card-top">
                    <span
                      v-if="
                        !hasAppliedWorkConditions &&
                        work.title === recentPlaceholderWorkTitle
                      "
                      class="story-card-recent"
                    >
                      最近编辑
                    </span>
                  </div>
                  <div class="story-placeholder-cover" aria-hidden="true">
                    <strong>{{ work.title.slice(0, 1) }}</strong>
                  </div>
                  <div class="story-placeholder-card-body">
                    <span class="story-placeholder-type">{{ work.type }}</span>
                    <p>{{ work.updated }}</p>
                  </div>
                </div>
                <h3 class="story-placeholder-title">{{ work.title }}</h3>
              </article>
            </div>
            <div v-else class="story-works-empty">
              <strong>没有找到匹配的作品</strong>
              <span>调整关键词或日期再试试。</span>
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
