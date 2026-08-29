<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, inject, watch } from 'vue';
import { routerKey, type Router } from 'vue-router';

import { ApiError } from '../../../../../lib/server-api/api-error';
import {
  getSession,
  type SessionSnapshot,
} from '../../../../../lib/server-api/session-api';
import {
  appendStoryMessage,
  appendPersonalStoryMessage,
  archivePersonalStoryProject,
  archiveStoryProject,
  confirmStoryDraft,
  createPersonalStoryConversation,
  createPersonalStoryImportJob,
  createStoryConversation,
  createStoryImportJob,
  createPersonalStoryProject,
  createStoryProject,
  discardStoryDraft,
  editStoryDraft,
  getStoryArtifact,
  getStoryGenerationRequest,
  getStoryProject,
  listPersonalStoryProjects,
  listStoryArtifacts,
  listStoryProjects,
  retryStoryGeneration,
  restorePersonalStoryProject,
  restoreStoryProject,
  type StoryArtifact,
  type StoryArtifactContentFormat,
  type StoryArtifactVersion,
  type StoryGenerationPipelineStage,
  type StoryProject,
} from '../../../api/story-api';
import { toStoryRoutePath } from '../../../routes/router';
import StoryStatusBar from '../shared/StoryStatusBar.vue';

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

interface StoryGeneratedAudio {
  shotId: string;
  audioBase64: string;
  mimeType: string;
}

interface StoryGeneratedImage {
  sceneId: string;
  sceneKey?: string;
  imageUrl: string;
  prompt?: string;
}

interface StoryGeneratedVideo {
  outputPath: string;
  subtitlePath: string;
  durationSeconds: number;
  sizeBytes: number;
  segmentCount: number;
}

interface StoryGeneratedContent {
  script: {
    title: string;
    logline: string;
    genre: string;
    synopsis: string;
    styleGuide?: string;
    characters: Array<{ name: string; role: string; personality: string }>;
    episodes: Array<{
      order: number;
      title: string;
      scenes: Array<{
        order: number;
        title: string;
        location: string;
        timeOfDay: string;
        shots: Array<{
          order: number;
          type: string;
          speaker?: string;
          line?: string;
          narration?: string;
        }>;
      }>;
    }>;
  };
  images: StoryGeneratedImage[];
  audio: StoryGeneratedAudio[];
  video?: StoryGeneratedVideo;
}

const props = defineProps<{
  projectId?: string;
}>();

const router = inject<Router | null>(routerKey, null);

const session = ref<SessionSnapshot | null>(null);
const projects = ref<StoryProject[]>([]);
const realProjects = ref<StoryProject[]>([]);
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
const projectAction = ref<'archiving' | 'restoring' | null>(null);
const projectActionError = ref('');
const saving = ref(false);
const confirming = ref(false);
const discarding = ref(false);
const searchQuery = ref('');
const searchDate = ref('');
const storyPrompt = ref('');
const voiceInputActive = ref(false);
const storyPromptSubmitting = ref(false);
const generationStage = ref<StoryGenerationPipelineStage | null>(null);
const generationError = ref('');
const activeGeneration = ref<{
  teamId: string;
  projectId: string;
  conversationId: string;
  requestId: string;
} | null>(null);
const appliedSearch = ref({ query: '', date: '' });
let speechRecognition: StorySpeechRecognition | null = null;
let generationPollTimer: number | undefined;
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

const storyCreationAction = ref<'story' | 'immersive' | 'upload' | null>(null);
const storyUploadInput = ref<HTMLInputElement | null>(null);

const activeTeam = computed(
  () =>
    session.value?.teams.find((team) => team.id === selectedTeamId.value) ??
    null,
);
const activeSpaceTitle = computed(() => activeTeam.value?.name ?? '个人空间');
const canEdit = computed(
  () =>
    project.value?.canEdit === true &&
    selectedVersion.value?.status === 'draft',
);
const canEditGenerated = computed(() => canEdit.value && !storyContent.value);
const projectMode = computed(() => (props.projectId ? 'project' : 'catalog'));
const generationStageLabel = computed(() => {
  switch (generationStage.value) {
    case 'queued':
      return '排队等待生成…';
    case 'script':
      return 'AI 正在创作剧本…';
    case 'images':
      return '正在生成场景配图…';
    case 'speech':
      return '正在合成对白配音…';
    case 'video':
      return '正在渲染短视频…';
    default:
      return 'AI 生成中…';
  }
});
const agentServiceUrl =
  import.meta.env.PUBLIC_AGENT_SERVICE_URL ?? 'http://127.0.0.1:3002';
const storyContent = computed<StoryGeneratedContent | null>(() => {
  if (selectedVersion.value?.contentFormat !== 'json') return null;
  try {
    const parsed = JSON.parse(
      selectedVersion.value.content,
    ) as StoryGeneratedContent;
    return parsed && typeof parsed.script === 'object' ? parsed : null;
  } catch {
    return null;
  }
});
const hasAppliedWorkConditions = computed(() =>
  Boolean(appliedSearch.value.query || appliedSearch.value.date),
);
const filteredProjects = computed(() => {
  const { query, date } = appliedSearch.value;
  const filteredWorks = projects.value.filter((work) => {
    const matchesQuery =
      !query ||
      [
        work.title,
        work.creationMode === 'immersive' ? '沉浸式创作' : '故事创建',
      ].some((value) => value.toLocaleLowerCase().includes(query));
    const matchesDate = !date || work.updatedAt.slice(0, 10) === date;
    return matchesQuery && matchesDate;
  });
  return hasAppliedWorkConditions.value
    ? filteredWorks
    : [...filteredWorks].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
});
const filteredRealWorks = computed(() => {
  const { query, date } = appliedSearch.value;
  return realProjects.value
    .filter((work) => {
      const matchesQuery =
        !query ||
        [work.title].some((value) => value.toLocaleLowerCase().includes(query));
      const matchesDate = !date || work.updatedAt.startsWith(date);
      return matchesQuery && matchesDate;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});
const recentProjectId = computed(() =>
  hasAppliedWorkConditions.value
    ? null
    : (filteredProjects.value[0]?.id ?? null),
);
const statusBarMessage = computed(() => {
  if (viewState.value === 'loading') return '读取中…';
  if (viewState.value === 'error') return '需要处理';
  if (saving.value || confirming.value || discarding.value) return '同步中…';
  if (actionMessage.value) return '已同步';
  return project.value ? '已连接' : '等待选择项目';
});
const storyCreationStatus = computed(() => {
  if (storyPromptSubmitting.value) return '正在准备你的故事……';
  if (storyCreationAction.value === 'upload') return '正在接收故事文件……';
  if (storyCreationAction.value === 'immersive') return '正在进入沉浸式创作……';
  if (storyCreationAction.value === 'story') return '正在创建故事……';
  return '';
});

const artifactTypeLabels: Record<StoryArtifact['type'], string> = {
  outline: '大纲',
  roles: '角色资产',
  worldview: '世界观',
  story: '故事页',
};

const versionStatusLabels: Record<StoryArtifactVersion['status'], string> = {
  draft: '待确认',
  confirmed: '已确认',
  discarded: '已丢弃',
};

onMounted(loadWorkspace);

watch(selectedTeamId, () => {
  if (session.value !== null && projectMode.value === 'catalog') {
    void loadCatalog();
  }
});

async function loadWorkspace() {
  viewState.value = 'loading';
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    session.value = await getSession();

    if (props.projectId) {
      const teamId = selectedTeamId.value ?? session.value.teams[0]?.id;
      if (!teamId) {
        throw new Error('个人项目请从故事模块页面继续编辑。');
      }
      selectedTeamId.value = teamId;
      await loadProject(teamId, props.projectId);
    } else {
      try {
        const { items } = await listStoryProjects(selectedTeamId.value, 50);
        realProjects.value = items;
      } catch {
        realProjects.value = [];
      }
      viewState.value = 'ready';
      await loadCatalog();
    }
  } catch (error) {
    handleError(error);
  }
}

async function loadCatalog() {
  viewState.value = 'loading';
  errorMessage.value = '';
  try {
    const response = activeTeam.value
      ? await listStoryProjects(activeTeam.value.id)
      : await listPersonalStoryProjects();
    projects.value = response.items;
    project.value = null;
    artifacts.value = [];
    viewState.value = 'ready';
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
  await resumeProjectGeneration(teamId, projectId);
  viewState.value = 'ready';
}

async function resumeProjectGeneration(teamId: string, projectId: string) {
  const active = readActiveGeneration(projectId);
  if (!active) return;
  try {
    const { generationRequest } = await getStoryGenerationRequest(
      teamId,
      projectId,
      active.conversationId,
      active.requestId,
    );
    generationStage.value = generationRequest.pipelineStage;
    if (generationRequest.status === 'processing') {
      activeGeneration.value = {
        teamId,
        projectId,
        conversationId: active.conversationId,
        requestId: active.requestId,
      };
      storyPromptSubmitting.value = true;
      generationError.value = '';
      void pollGeneration();
    } else if (generationRequest.status === 'failed') {
      activeGeneration.value = {
        teamId,
        projectId,
        conversationId: active.conversationId,
        requestId: active.requestId,
      };
      storyPromptSubmitting.value = false;
      generationError.value = 'AI 生成失败，可以点击「重试」重新生成。';
    } else {
      clearActiveGeneration(projectId);
    }
  } catch {
    // Polling the stored task is best-effort; the project page still loads.
  }
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

function audioSource(shot: StoryGeneratedAudio): string {
  return `data:${shot.mimeType};base64,${shot.audioBase64}`;
}
function videoSource(video: StoryGeneratedVideo): string {
  const fileName = video.outputPath.split(/[\\/]/).pop() ?? '';
  return `${agentServiceUrl}/v1/story-videos/files/${encodeURIComponent(fileName)}`;
}

function subtitleSource(video: StoryGeneratedVideo): string {
  const fileName = video.subtitlePath.split(/[\\/]/).pop() ?? '';
  return `${agentServiceUrl}/v1/story-videos/files/${encodeURIComponent(fileName)}`;
}
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function storyModulePath(
  mode: 'story' | 'immersive',
  projectId: string,
): string {
  return mode === 'immersive'
    ? `/stories/immersive/${encodeURIComponent(projectId)}/outline`
    : `/stories/${encodeURIComponent(projectId)}/outline`;
}

function catalogProjectPath(project: StoryProject): string {
  const path = storyModulePath(
    project.creationMode === 'immersive' ? 'immersive' : 'story',
    project.id,
  );
  return activeTeam.value
    ? `${path}?teamId=${encodeURIComponent(activeTeam.value.id)}`
    : path;
}

function navigateStoryPath(path: string) {
  if (router) {
    void router.push(toStoryRoutePath(path));
    return;
  }
  window.location.assign(path);
}

function handleStoryLink(event: MouseEvent, path: string) {
  if (!router) return;
  event.preventDefault();
  navigateStoryPath(path);
}

function projectTeamId(target: StoryProject): string | null {
  return target.tenantId === null ? null : (activeTeam.value?.id ?? null);
}

async function archiveProject(target: StoryProject): Promise<void> {
  if (!target.canArchive || projectAction.value !== null) return;
  projectAction.value = 'archiving';
  projectActionError.value = '';
  try {
    const teamId = projectTeamId(target);
    const response = teamId
      ? await archiveStoryProject(teamId, target.id, target.revision)
      : await archivePersonalStoryProject(target.id, target.revision);
    if (project.value?.id === target.id) project.value = response.project;
    projects.value = projects.value.map((item) =>
      item.id === target.id ? response.project : item,
    );
    actionMessage.value = '故事已归档，保留期为 30 天。';
  } catch (error) {
    projectActionError.value =
      error instanceof Error ? error.message : '归档失败，请稍后重试。';
  } finally {
    projectAction.value = null;
  }
}

async function restoreProject(target: StoryProject): Promise<void> {
  if (!target.canRestore || projectAction.value !== null) return;
  projectAction.value = 'restoring';
  projectActionError.value = '';
  try {
    const teamId = projectTeamId(target);
    const response = teamId
      ? await restoreStoryProject(teamId, target.id, target.revision)
      : await restorePersonalStoryProject(target.id, target.revision);
    if (project.value?.id === target.id) project.value = response.project;
    projects.value = projects.value.map((item) =>
      item.id === target.id ? response.project : item,
    );
    actionMessage.value = '故事已恢复，可以继续创作。';
  } catch (error) {
    projectActionError.value =
      error instanceof Error ? error.message : '恢复失败，请稍后重试。';
  } finally {
    projectAction.value = null;
  }
}

function handleStoryProjectLink(event: MouseEvent, target: StoryProject) {
  if (target.status === 'archived') {
    event.preventDefault();
    return;
  }
  handleStoryLink(event, catalogProjectPath(target));
}

function projectModeLabel(project: StoryProject): string {
  return project.creationMode === 'immersive' ? '沉浸式创作' : '故事创建';
}

function rememberPendingStoryImport(
  projectId: string,
  importJobId: string,
  file: File,
) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      `duoduo-story-import:${projectId}`,
      JSON.stringify({
        importJobId,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
      }),
    );
  } catch {
    // The editor can still be opened when session storage is unavailable.
  }
}

async function createStoryAsset(mode: 'story' | 'immersive', file?: File) {
  if (!session.value || storyCreationAction.value) return;
  storyCreationAction.value = file ? 'upload' : mode;
  errorMessage.value = '';
  actionMessage.value = '';
  try {
    const title = mode === 'immersive' ? '未命名沉浸式故事' : '未命名故事';
    const { project: createdProject } = activeTeam.value
      ? await createStoryProject(activeTeam.value.id, {
          title,
          creationMode: mode === 'immersive' ? 'immersive' : 'standard',
        })
      : await createPersonalStoryProject({
          title,
          creationMode: mode === 'immersive' ? 'immersive' : 'standard',
        });
    if (file) {
      const { importJob } = activeTeam.value
        ? await createStoryImportJob(
            activeTeam.value.id,
            createdProject.id,
            file,
          )
        : await createPersonalStoryImportJob(createdProject.id, file);
      rememberPendingStoryImport(createdProject.id, importJob.id, file);
    }
    const nextPath = storyModulePath(mode, createdProject.id);
    navigateStoryPath(file ? `${nextPath}?import=pending` : nextPath);
  } catch (error) {
    handleError(error);
  } finally {
    storyCreationAction.value = null;
  }
}

function startStoryCreation(mode: 'story' | 'immersive') {
  void createStoryAsset(mode);
}

function openStoryUpload() {
  if (
    !session.value ||
    storyPromptSubmitting.value ||
    storyCreationAction.value
  )
    return;
  storyUploadInput.value?.click();
}

function handleStoryUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  void createStoryAsset('story', file);
}

async function submitStoryPrompt() {
  const prompt = storyPrompt.value.trim();
  if (!prompt || storyPromptSubmitting.value || storyCreationAction.value)
    return;
  if (!session.value) {
    actionMessage.value = '正在连接创作空间，请稍后再试。';
    return;
  }

  storyPromptSubmitting.value = true;
  errorMessage.value = '';
  actionMessage.value = '';
  const title = createStoryTitle(prompt);
  try {
    const { project: createdProject } = activeTeam.value
      ? await createStoryProject(activeTeam.value.id, {
          title,
          creationMode: 'standard',
        })
      : await createPersonalStoryProject({
          title,
          creationMode: 'standard',
        });
    const { conversation } = activeTeam.value
      ? await createStoryConversation(activeTeam.value.id, createdProject.id, {
          title: '第一次创作对话',
        })
      : await createPersonalStoryConversation(createdProject.id, {
          title: '第一次创作对话',
        });
    if (activeTeam.value) {
      await appendStoryMessage(
        activeTeam.value.id,
        createdProject.id,
        conversation.id,
        prompt,
      );
    } else {
      await appendPersonalStoryMessage(
        createdProject.id,
        conversation.id,
        prompt,
      );
    }
    rememberRecentConversation({
      id: conversation.id,
      projectId: createdProject.id,
      title: conversation.title,
      requestId: generationRequest.id,
    });
    storyPrompt.value = '';
    generationStage.value = null;
    generationError.value = '';
    activeGeneration.value = {
      teamId: activeTeam.value.id,
      projectId: createdProject.id,
      conversationId: conversation.id,
      requestId: generationRequest.id,
    };
    await pollGeneration();
    navigateStoryPath(
      activeTeam.value
        ? `/stories/${createdProject.id}/outline?teamId=${encodeURIComponent(activeTeam.value.id)}`
        : `/stories/${createdProject.id}/outline`,
    );
  } catch (error) {
    generationError.value = '创建故事项目失败，请重试。';
    handleError(error);
    storyPromptSubmitting.value = false;
  }
}

async function pollGeneration() {
  const generation = activeGeneration.value;
  if (!generation) return;
  try {
    const { generationRequest } = await getStoryGenerationRequest(
      generation.teamId,
      generation.projectId,
      generation.conversationId,
      generation.requestId,
    );
    generationStage.value = generationRequest.pipelineStage;
    if (generationRequest.status === 'succeeded') {
      clearActiveGeneration(generation.projectId);
      activeGeneration.value = null;
      storyPromptSubmitting.value = false;
      window.location.assign(`/stories/${generation.projectId}`);
      return;
    }
    if (generationRequest.status === 'failed') {
      storyPromptSubmitting.value = false;
      generationError.value = 'AI 生成失败，可以点击「重试」重新生成。';
      return;
    }
  } catch {
    // Transient polling failure — keep trying.
  }
  generationPollTimer = window.setTimeout(pollGeneration, 3000);
}

async function retryCurrentGeneration() {
  const generation = activeGeneration.value;
  if (!generation) return;
  generationError.value = '';
  generationStage.value = null;
  try {
    await retryStoryGeneration(
      generation.teamId,
      generation.projectId,
      generation.conversationId,
      generation.requestId,
    );
    storyPromptSubmitting.value = true;
    await pollGeneration();
  } catch (error) {
    generationError.value = '重试失败，请稍后再试。';
    handleError(error);
  }
}

onUnmounted(() => {
  if (generationPollTimer !== undefined) {
    window.clearTimeout(generationPollTimer);
  }
});

function rememberRecentConversation(conversation: {
  id: string;
  projectId: string;
  title: string;
  requestId?: string;
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

const activeGenerationStorageKey = 'duoduo-story-active-generations';

function readActiveGeneration(
  projectId: string,
): { conversationId: string; requestId: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(activeGenerationStorageKey) ?? '{}',
    );
    const entry = stored?.[projectId];
    return entry &&
      typeof entry.conversationId === 'string' &&
      typeof entry.requestId === 'string'
      ? { conversationId: entry.conversationId, requestId: entry.requestId }
      : null;
  } catch {
    return null;
  }
}

function saveActiveGeneration(
  projectId: string,
  conversationId: string,
  requestId: string,
) {
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(activeGenerationStorageKey) ?? '{}',
    );
    window.localStorage.setItem(
      activeGenerationStorageKey,
      JSON.stringify({
        ...(stored && typeof stored === 'object' ? stored : {}),
        [projectId]: { conversationId, requestId, updatedAt: Date.now() },
      }),
    );
  } catch {
    // Progress tracking is a convenience; generation still works without it.
  }
}

function clearActiveGeneration(projectId: string) {
  if (typeof window === 'undefined') return;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(activeGenerationStorageKey) ?? '{}',
    );
    if (stored && typeof stored === 'object' && projectId in stored) {
      const next = { ...stored };
      delete next[projectId];
      window.localStorage.setItem(
        activeGenerationStorageKey,
        JSON.stringify(next),
      );
    }
  } catch {
    // Best-effort cleanup.
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
          <div
            class="story-creation-actions story-creation-actions-skeleton"
            aria-hidden="true"
          >
            <div
              v-for="index in 3"
              :key="index"
              class="story-creation-action-skeleton"
            >
              <span
                class="story-creation-action-icon story-skeleton-shimmer"
              ></span>
              <span
                class="story-creation-action-label story-skeleton-shimmer"
              ></span>
            </div>
          </div>
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
                  <span
                    class="story-skeleton-type story-skeleton-shimmer"
                  ></span>
                  <span
                    class="story-skeleton-card-meta story-skeleton-shimmer"
                  ></span>
                </div>
              </div>
              <span class="story-skeleton-title story-skeleton-shimmer"></span>
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
                  :disabled="storyPromptSubmitting || storyCreationAction"
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
                    !storyPrompt.trim() ||
                    storyPromptSubmitting ||
                    storyCreationAction ||
                    !session
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
                  :disabled="storyPromptSubmitting || storyCreationAction"
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
                v-if="storyCreationStatus"
                class="story-quick-input-status"
                role="status"
              >
                {{
                  generationError || generationStageLabel || storyCreationStatus
                }}
              </p>
              <div
                v-if="generationError && activeGeneration"
                class="story-quick-input-actions"
              >
                <button
                  class="button button-quiet"
                  type="button"
                  @click="retryCurrentGeneration"
                >
                  重试生成 <span>↻</span>
                </button>
              </div>
            </section>
            <div class="story-creation-actions" aria-label="开始创作">
              <button
                class="story-creation-action story-creation-action-story"
                type="button"
                :disabled="
                  !session || storyPromptSubmitting || storyCreationAction
                "
                @click="startStoryCreation('story')"
              >
                <span class="story-creation-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                    <path
                      d="M4 5.5A2.5 2.5 0 0 1 6.5 3H10l2 2h5.5A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-11Z"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="story-creation-action-label">故事创建</span>
              </button>
              <button
                class="story-creation-action story-creation-action-immersive"
                type="button"
                :disabled="
                  !session || storyPromptSubmitting || storyCreationAction
                "
                @click="startStoryCreation('immersive')"
              >
                <span class="story-creation-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                    <rect
                      x="3"
                      y="5"
                      width="18"
                      height="14"
                      rx="2"
                      stroke="currentColor"
                      stroke-width="1.6"
                    />
                    <path
                      d="m8 5 2 14M14 5l2 14M3 9h18M3 15h18"
                      stroke="currentColor"
                      stroke-width="1.3"
                    />
                  </svg>
                </span>
                <span class="story-creation-action-label">沉浸式创作</span>
              </button>
              <button
                class="story-creation-action story-creation-action-upload"
                type="button"
                :disabled="
                  !session || storyPromptSubmitting || storyCreationAction
                "
                @click="openStoryUpload"
              >
                <span class="story-creation-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
                    <path
                      d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span class="story-creation-action-label">上传故事</span>
              </button>
              <input
                ref="storyUploadInput"
                class="story-creation-upload-input"
                type="file"
                accept=".txt,.md,.doc,.docx,.pdf"
                tabindex="-1"
                aria-hidden="true"
                @change="handleStoryUpload"
              />
            </div>
          </div>
          <section
            id="story-works"
            class="story-works-region"
            aria-label="作品列表"
          >
            <header class="story-works-header">
              <div class="story-works-heading">
                <div class="story-works-title-row">
                  <h1 id="story-works-title">{{ activeSpaceTitle }}</h1>
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
                      <option :value="null">个人空间</option>
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

            <!-- <div
              v-if="filteredRealWorks.length"
              class="story-placeholder-grid"
            >
              <a
                v-for="work in filteredRealWorks"
                :key="work.id"
                class="story-placeholder-item"
                :href="`/stories/${work.id}`"
              >
                <div class="story-placeholder-card">
                  <div class="story-placeholder-card-top">
                    <span class="story-card-recent">故事项目</span>
                  </div>
                  <div class="story-placeholder-cover" aria-hidden="true">
                    <strong>{{ work.title.slice(0, 1) }}</strong>
                  </div>
                  <div class="story-placeholder-card-body">
                    <span class="story-placeholder-type">故事项目</span>
                    <p>{{ formatDate(work.updatedAt) }}</p>
                  </div>
                </div>
                <h3 class="story-placeholder-title">{{ work.title }}</h3>
              </a>
            </div>
            <div
              v-else-if="filteredPlaceholderWorks.length"
              class="story-placeholder-grid"
            >
              <article
                v-for="work in filteredPlaceholderWorks"
                :key="work.title" -->
            <div v-if="filteredProjects.length" class="story-placeholder-grid">
              <a
                v-for="work in filteredProjects"
                :key="work.id"
                class="story-placeholder-item"
                :class="{ 'is-archived': work.status === 'archived' }"
                :href="catalogProjectPath(work)"
                @click="handleStoryProjectLink($event, work)"
              >
                <div class="story-placeholder-card">
                  <div class="story-placeholder-card-top">
                    <span
                      v-if="
                        !hasAppliedWorkConditions && work.id === recentProjectId
                      "
                      class="story-card-recent"
                    >
                      最近编辑
                    </span>
                    <button
                      v-if="work.status === 'active' && work.canArchive"
                      class="story-project-card-action story-project-card-action-top"
                      type="button"
                      :disabled="projectAction !== null"
                      :aria-label="`归档${work.title}`"
                      @click.stop.prevent="archiveProject(work)"
                    >
                      {{ projectAction === 'archiving' ? '归档中…' : '归档' }}
                    </button>
                  </div>
                  <div class="story-placeholder-cover" aria-hidden="true">
                    <strong>{{ work.title.slice(0, 1) }}</strong>
                  </div>
                  <div class="story-placeholder-card-body">
                    <span class="story-placeholder-type">{{
                      projectModeLabel(work)
                    }}</span>
                    <p>{{ formatDate(work.updatedAt) }}</p>
                  </div>
                </div>
                <h3 class="story-placeholder-title">{{ work.title }}</h3>
                <button
                  v-if="work.status === 'archived' && work.canRestore"
                  class="story-project-card-action"
                  type="button"
                  :disabled="projectAction !== null"
                  @click.stop.prevent="restoreProject(work)"
                >
                  {{ projectAction === 'restoring' ? '恢复中…' : '恢复故事' }}
                </button>
              </a>
            </div>
            <div v-else class="story-works-empty">
              <strong>{{
                hasAppliedWorkConditions ? '没有找到匹配的作品' : '还没有作品'
              }}</strong>
              <span>{{
                hasAppliedWorkConditions
                  ? '调整关键词或日期再试试。'
                  : '从上方开始创建你的第一个故事。'
              }}</span>
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
            <p
              v-if="project?.status === 'archived' && project?.purgeAt"
              class="project-retention-note"
            >
              将于 {{ formatDate(project.purgeAt) }} 后永久删除成果与角色资产
            </p>
            <div v-if="project" class="story-project-actions">
              <button
                v-if="project.status === 'archived' && project.canRestore"
                class="story-project-action"
                type="button"
                :disabled="projectAction !== null"
                @click="restoreProject(project)"
              >
                {{ projectAction === 'restoring' ? '恢复中…' : '恢复故事' }}
              </button>
              <p
                v-if="projectActionError"
                class="story-project-action-error"
                role="alert"
              >
                {{ projectActionError }}
              </p>
            </div>
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
                <div v-if="storyContent" class="story-generated-preview">
                  <div class="story-preview-title">
                    <h4>{{ storyContent.script.title }}</h4>
                    <span class="story-preview-genre">{{
                      storyContent.script.genre
                    }}</span>
                  </div>
                  <p class="story-preview-logline">
                    {{ storyContent.script.logline }}
                  </p>
                  <p class="story-preview-synopsis">
                    {{ storyContent.script.synopsis }}
                  </p>

                  <template v-if="storyContent.video">
                    <video
                      :src="videoSource(storyContent.video)"
                      controls
                      preload="metadata"
                      class="story-preview-video"
                    ></video>
                    <div class="story-preview-meta">
                      <span>
                        视频
                        {{ formatDuration(storyContent.video.durationSeconds) }}
                        ·
                        {{ Math.round(storyContent.video.sizeBytes / 1024) }}
                        KB
                      </span>
                      <a
                        :href="subtitleSource(storyContent.video)"
                        target="_blank"
                        rel="noreferrer"
                        >下载字幕 (.srt)</a
                      >
                    </div>
                  </template>

                  <div
                    v-if="storyContent.images.length"
                    class="story-preview-section"
                  >
                    <strong>场景配图</strong>
                    <div class="story-preview-images">
                      <figure
                        v-for="image in storyContent.images"
                        :key="image.sceneId"
                      >
                        <img
                          :src="image.imageUrl"
                          :alt="image.sceneId"
                          loading="lazy"
                        />
                        <figcaption>{{ image.sceneId }}</figcaption>
                      </figure>
                    </div>
                  </div>

                  <div
                    v-if="storyContent.audio.length"
                    class="story-preview-section"
                  >
                    <strong
                      >对白配音（{{ storyContent.audio.length }} 段）</strong
                    >
                    <div class="story-preview-audio">
                      <div
                        v-for="shot in storyContent.audio"
                        :key="shot.shotId"
                        class="story-preview-audio-item"
                      >
                        <span>{{ shot.shotId }}</span>
                        <audio
                          :src="audioSource(shot)"
                          controls
                          preload="none"
                        ></audio>
                      </div>
                    </div>
                  </div>

                  <div class="story-preview-section">
                    <strong>剧本大纲</strong>
                    <div
                      v-for="episode in storyContent.script.episodes"
                      :key="episode.order"
                      class="story-preview-episode"
                    >
                      <h5>第 {{ episode.order }} 集 · {{ episode.title }}</h5>
                      <div
                        v-for="scene in episode.scenes"
                        :key="scene.order"
                        class="story-preview-scene"
                      >
                        <span class="story-preview-scene-heading"
                          >场景 {{ scene.order }} · {{ scene.title }}（{{
                            scene.location
                          }}，{{ scene.timeOfDay }}）</span
                        >
                        <ul>
                          <li v-for="shot in scene.shots" :key="shot.order">
                            <template v-if="shot.type === 'dialogue'"
                              >{{ shot.speaker }}：{{ shot.line }}</template
                            >
                            <template v-else
                              >（旁白）{{ shot.narration }}</template
                            >
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
                <textarea
                  v-else
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
              <div
                v-else-if="projectMode === 'project' && activeGeneration"
                class="story-generation-progress"
                role="status"
              >
                <span class="panel-icon" aria-hidden="true">✦</span>
                <strong>{{ generationError || generationStageLabel }}</strong>
                <span
                  >生成完成后会自动刷新；也可以先离开，稍后回来查看进度。</span
                >
                <button
                  v-if="generationError"
                  class="button button-primary"
                  type="button"
                  @click="retryCurrentGeneration"
                >
                  重试生成 <span>↻</span>
                </button>
              </div>
              <div v-else class="artifact-no-version">
                <span class="panel-icon" aria-hidden="true">○</span>
                <strong>这个成果还没有可查看的版本</strong>
                <span>它会在故事对话产出第一版内容后出现在这里。</span>
              </div>
              <div
                v-if="selectedVersion?.status === 'draft' && !storyContent"
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

<style scoped>
.story-generated-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 18px;
}

.story-preview-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.story-preview-title h4 {
  margin: 0;
  font-size: 20px;
  line-height: 1.2;
}

.story-preview-genre {
  font-size: 12px;
  opacity: 0.7;
}

.story-preview-logline {
  margin: 0;
  font-weight: 600;
}

.story-preview-synopsis {
  margin: 0;
  font-size: 14px;
  opacity: 0.85;
  line-height: 1.6;
}

.story-preview-video {
  width: 100%;
  max-width: 480px;
  aspect-ratio: 9 / 16;
  background: #000;
  border-radius: 8px;
}

.story-preview-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  opacity: 0.75;
}

.story-preview-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--hairline, rgba(255, 255, 255, 0.12));
  padding-top: 14px;
}

.story-preview-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.story-preview-images figure {
  margin: 0;
}

.story-preview-images img {
  width: 100%;
  aspect-ratio: 9 / 16;
  object-fit: cover;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
}

.story-preview-images figcaption {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.story-preview-audio {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.story-preview-audio-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  opacity: 0.85;
}

.story-preview-audio-item audio {
  height: 32px;
}

.story-quick-input-actions {
  margin-top: 10px;
}

.story-generation-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 24px 20px;
}

.story-generation-progress strong {
  font-size: 16px;
  line-height: 1.4;
}

.story-generation-progress > span:not(.panel-icon) {
  font-size: 13px;
  opacity: 0.75;
}

.story-preview-episode {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.story-preview-episode h5 {
  margin: 8px 0 0;
}

.story-preview-scene {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.story-preview-scene-heading {
  font-size: 13px;
  opacity: 0.8;
}

.story-preview-scene ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
}
</style>
