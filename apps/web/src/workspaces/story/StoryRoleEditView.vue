<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import { ApiError } from '../../lib/server-api/api-error';
import {
  archiveProjectStoryRoleAsset,
  completePersonalStoryAssetUpload,
  completeStoryAssetUpload,
  createPersonalStoryAssetUploadUrl,
  createStoryAssetUploadUrl,
  getProjectStoryRoleAsset,
  uploadStoryAssetFile,
  updateProjectStoryRoleAsset,
} from './story-role-api';
import {
  MAX_COVER_ASSET_BYTES,
  isSupportedCoverContentType,
} from './story-role-cover';
import {
  storyRoleCampOptions,
  storyRoleCategoryLabel,
  storyRoleCategoryOptions,
  storyRoleAppearanceFrequencyOptions,
  storyRoleGenderOptions,
  type StoryRoleAsset,
} from './story-role-assets';
import {
  storyEraFromWorldview,
  storyRolePlaceholderUrl,
} from './story-role-placeholder';
import { useStoryWorldviewStateRegistry } from './story-worldview-state';

const route = useRoute();
const router = useRouter();
const worldviewStateRegistry = useStoryWorldviewStateRegistry();
const projectId = computed(() => String(route.params.projectId ?? ''));
const roleId = computed(() => String(route.params.roleId ?? ''));
const teamId = computed(() => {
  const value = route.query.teamId;
  return typeof value === 'string' && value ? value : null;
});
const scope = computed(() => ({
  projectId: projectId.value,
  teamId: teamId.value,
}));
const storyEra = computed(() =>
  storyEraFromWorldview(worldviewStateRegistry.getGraph(projectId.value)),
);
const rolesLocation = computed(() => ({
  path: `/${encodeURIComponent(projectId.value)}/roles`,
  query: teamId.value ? { teamId: teamId.value } : undefined,
}));
const draft = ref<StoryRoleAsset | null>(null);
const initialCoverAssetId = ref<string | null>(null);
const coverAssetId = ref<string | null>(null);
const initialViewAssetId = ref<string | null>(null);
const viewAssetId = ref<string | null>(null);
const coverAssetPreviewUrl = ref<string | null>(null);
const viewAssetPreviewUrl = ref<string | null>(null);
const coverAssetFileName = ref<string | null>(null);
const viewAssetFileName = ref<string | null>(null);
const coverUploadProgress = ref(0);
const viewUploadProgress = ref(0);
const coverUploadState = ref<'idle' | 'uploading' | 'error'>('idle');
const viewUploadState = ref<'idle' | 'uploading' | 'error'>('idle');
const coverUploadError = ref('');
const viewUploadError = ref('');
const viewState = ref<'loading' | 'ready' | 'not-found' | 'error'>('loading');
const advancedConfigExpanded = ref(false);
const saveState = ref<
  'idle' | 'saving' | 'saved' | 'conflict' | 'error' | 'deleting'
>('idle');

watch(
  [scope, roleId],
  () => {
    void loadRole();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  revokeCoverPreview();
  revokeViewPreview();
});

async function loadRole() {
  viewState.value = 'loading';
  draft.value = null;
  advancedConfigExpanded.value = false;
  saveState.value = 'idle';
  try {
    const { roleAsset } = await getProjectStoryRoleAsset(
      scope.value,
      roleId.value,
    );
    draft.value = cloneRoleDraft(roleAsset);
    initialCoverAssetId.value = roleAsset.coverAssetId;
    coverAssetId.value = roleAsset.coverAssetId;
    coverAssetFileName.value = roleAsset.coverAsset?.originalFileName ?? null;
    initialViewAssetId.value = roleAsset.viewAssetId;
    viewAssetId.value = roleAsset.viewAssetId;
    viewAssetFileName.value = roleAsset.viewAsset?.originalFileName ?? null;
    revokeCoverPreview();
    revokeViewPreview();
    coverUploadState.value = 'idle';
    coverUploadProgress.value = 0;
    coverUploadError.value = '';
    viewUploadState.value = 'idle';
    viewUploadProgress.value = 0;
    viewUploadError.value = '';
    viewState.value = 'ready';
  } catch (error) {
    viewState.value =
      error instanceof ApiError && error.status === 404 ? 'not-found' : 'error';
  }
}

function markChanged() {
  if (saveState.value !== 'saving' && saveState.value !== 'deleting') {
    saveState.value = 'idle';
  }
}

async function saveRole() {
  if (
    !draft.value ||
    saveState.value === 'saving' ||
    coverUploadState.value === 'uploading' ||
    viewUploadState.value === 'uploading'
  )
    return;
  saveState.value = 'saving';
  try {
    const { roleAsset } = await updateProjectStoryRoleAsset(
      scope.value,
      draft.value.id,
      {
        category: draft.value.category,
        name: draft.value.name.trim(),
        occupation: draft.value.occupation.trim(),
        personalityCore: draft.value.personalityCore.trim(),
        motivationConflict: draft.value.motivationConflict.trim(),
        mainlineRelation: draft.value.mainlineRelation.trim(),
        gender: draft.value.gender,
        camp: draft.value.camp,
        appearanceFrequency: draft.value.appearanceFrequency,
        speechProfile: draft.value.speechProfile,
        ...(coverAssetId.value !== initialCoverAssetId.value
          ? { coverAssetId: coverAssetId.value }
          : {}),
        ...(viewAssetId.value !== initialViewAssetId.value
          ? { viewAssetId: viewAssetId.value }
          : {}),
        expectedRevision: draft.value.revision,
      },
    );
    draft.value = cloneRoleDraft(roleAsset);
    initialCoverAssetId.value = roleAsset.coverAssetId;
    coverAssetId.value = roleAsset.coverAssetId;
    coverAssetFileName.value = roleAsset.coverAsset?.originalFileName ?? null;
    initialViewAssetId.value = roleAsset.viewAssetId;
    viewAssetId.value = roleAsset.viewAssetId;
    viewAssetFileName.value = roleAsset.viewAsset?.originalFileName ?? null;
    revokeCoverPreview();
    revokeViewPreview();
    coverUploadState.value = 'idle';
    coverUploadProgress.value = 0;
    viewUploadState.value = 'idle';
    viewUploadProgress.value = 0;
    saveState.value = 'saved';
  } catch (error) {
    saveState.value =
      error instanceof ApiError && error.status === 409 ? 'conflict' : 'error';
  }
}

async function selectCover(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  coverUploadError.value = '';
  if (!isSupportedCoverContentType(file.type)) {
    coverUploadState.value = 'error';
    coverUploadError.value = '仅支持 JPG、PNG 或 WebP 图片。';
    return;
  }
  if (file.size < 1 || file.size > MAX_COVER_ASSET_BYTES) {
    coverUploadState.value = 'error';
    coverUploadError.value = '封面图大小需在 1B 至 20MB 之间。';
    return;
  }

  revokeCoverPreview();
  coverAssetPreviewUrl.value = URL.createObjectURL(file);
  coverUploadState.value = 'uploading';
  coverUploadProgress.value = 0;
  try {
    const uploadInput = {
      fileName: file.name,
      contentType: file.type,
      byteSize: file.size,
    };
    const upload = teamId.value
      ? await createStoryAssetUploadUrl(
          teamId.value,
          projectId.value,
          uploadInput,
        )
      : await createPersonalStoryAssetUploadUrl(projectId.value, uploadInput);
    await uploadStoryAssetFile(
      upload.uploadUrl,
      file,
      upload.requiredHeaders,
      (progress) => {
        coverUploadProgress.value = progress;
      },
    );
    const completed = teamId.value
      ? await completeStoryAssetUpload(
          teamId.value,
          projectId.value,
          upload.asset.id,
        )
      : await completePersonalStoryAssetUpload(
          projectId.value,
          upload.asset.id,
        );
    coverAssetId.value = completed.asset.id;
    coverAssetFileName.value = completed.asset.originalFileName;
    coverUploadState.value = 'idle';
    coverUploadProgress.value = 100;
    markChanged();
  } catch {
    revokeCoverPreview();
    coverUploadState.value = 'error';
    coverUploadError.value = '封面图上传失败，请重试。';
  }
}

function removeCover() {
  coverAssetId.value = null;
  coverAssetFileName.value = null;
  revokeCoverPreview();
  coverUploadState.value = 'idle';
  coverUploadError.value = '';
  markChanged();
}

async function selectView(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  viewUploadError.value = '';
  if (!isSupportedCoverContentType(file.type)) {
    viewUploadState.value = 'error';
    viewUploadError.value = '仅支持 JPG、PNG 或 WebP 图片。';
    return;
  }
  if (file.size < 1 || file.size > MAX_COVER_ASSET_BYTES) {
    viewUploadState.value = 'error';
    viewUploadError.value = '人物视图大小需在 1B 至 20MB 之间。';
    return;
  }

  revokeViewPreview();
  viewAssetPreviewUrl.value = URL.createObjectURL(file);
  viewUploadState.value = 'uploading';
  viewUploadProgress.value = 0;
  try {
    const uploadInput = {
      fileName: file.name,
      contentType: file.type,
      byteSize: file.size,
    };
    const upload = teamId.value
      ? await createStoryAssetUploadUrl(
          teamId.value,
          projectId.value,
          uploadInput,
        )
      : await createPersonalStoryAssetUploadUrl(projectId.value, uploadInput);
    await uploadStoryAssetFile(
      upload.uploadUrl,
      file,
      upload.requiredHeaders,
      (progress) => {
        viewUploadProgress.value = progress;
      },
    );
    const completed = teamId.value
      ? await completeStoryAssetUpload(
          teamId.value,
          projectId.value,
          upload.asset.id,
        )
      : await completePersonalStoryAssetUpload(
          projectId.value,
          upload.asset.id,
        );
    viewAssetId.value = completed.asset.id;
    viewAssetFileName.value = completed.asset.originalFileName;
    viewUploadState.value = 'idle';
    viewUploadProgress.value = 100;
    markChanged();
  } catch {
    revokeViewPreview();
    viewUploadState.value = 'error';
    viewUploadError.value = '人物视图上传失败，请重试。';
  }
}

function revokeCoverPreview() {
  if (coverAssetPreviewUrl.value) {
    URL.revokeObjectURL(coverAssetPreviewUrl.value);
    coverAssetPreviewUrl.value = null;
  }
}

function removeView() {
  viewAssetId.value = null;
  viewAssetFileName.value = null;
  revokeViewPreview();
  viewUploadState.value = 'idle';
  viewUploadError.value = '';
  markChanged();
}

function revokeViewPreview() {
  if (viewAssetPreviewUrl.value) {
    URL.revokeObjectURL(viewAssetPreviewUrl.value);
    viewAssetPreviewUrl.value = null;
  }
}

const coverPreviewUrl = computed(() => {
  if (coverAssetPreviewUrl.value) return coverAssetPreviewUrl.value;
  if (coverAssetId.value !== initialCoverAssetId.value) return null;
  return draft.value?.coverAsset?.downloadUrl ?? null;
});

const viewPreviewUrl = computed(() => {
  if (viewAssetPreviewUrl.value) return viewAssetPreviewUrl.value;
  if (viewAssetId.value !== initialViewAssetId.value) return null;
  return draft.value?.viewAsset?.downloadUrl ?? null;
});

async function archiveRole() {
  if (!draft.value || saveState.value === 'deleting') return;
  if (
    typeof window !== 'undefined' &&
    !window.confirm(`归档角色“${draft.value.name}”？`)
  ) {
    return;
  }
  saveState.value = 'deleting';
  try {
    await archiveProjectStoryRoleAsset(
      scope.value,
      draft.value.id,
      draft.value.revision,
    );
    await router.replace(rolesLocation.value);
  } catch (error) {
    saveState.value =
      error instanceof ApiError && error.status === 409 ? 'conflict' : 'error';
  }
}

function cloneRoleDraft(role: StoryRoleAsset): StoryRoleAsset {
  return {
    ...role,
    speechProfile: {
      ...role.speechProfile,
      habits: [...role.speechProfile.habits],
      dialogueExamples: role.speechProfile.dialogueExamples.map((example) => ({
        ...example,
      })),
    },
  };
}

function addSpeechHabit() {
  if (!draft.value || draft.value.speechProfile.habits.length >= 12) return;
  draft.value.speechProfile.habits.push('');
  markChanged();
}

function removeSpeechHabit(index: number) {
  if (!draft.value) return;
  draft.value.speechProfile.habits.splice(index, 1);
  markChanged();
}

function addDialogueExample() {
  if (!draft.value || draft.value.speechProfile.dialogueExamples.length >= 8)
    return;
  draft.value.speechProfile.dialogueExamples.push({
    context: '',
    line: '',
  });
  markChanged();
}

function removeDialogueExample(index: number) {
  if (!draft.value) return;
  draft.value.speechProfile.dialogueExamples.splice(index, 1);
  markChanged();
}
</script>

<template>
  <section class="story-project-route" aria-labelledby="story-role-edit-title">
    <div class="story-project-content-toolbar">
      <RouterLink class="story-project-back-link" :to="rolesLocation">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          width="16"
          height="16"
          fill="none"
        >
          <path
            d="M8.2 4.2 2.8 10l5.4 5.8M3.2 10h14"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>返回角色资产</span>
      </RouterLink>

      <span class="story-project-module-kicker">动力资产 / ROLES</span>

      <div
        v-if="viewState === 'ready' && draft"
        class="story-project-toolbar-actions"
        aria-label="角色操作"
      >
        <button
          class="story-project-toolbar-action"
          type="button"
          :disabled="
            saveState === 'saving' ||
            saveState === 'deleting' ||
            coverUploadState === 'uploading' ||
            viewUploadState === 'uploading'
          "
          @click="archiveRole"
        >
          {{ saveState === 'deleting' ? '归档中…' : '归档角色' }}
        </button>
        <button
          class="story-project-toolbar-action"
          type="submit"
          form="story-role-edit-form"
          :disabled="
            saveState === 'saving' ||
            saveState === 'deleting' ||
            coverUploadState === 'uploading' ||
            viewUploadState === 'uploading'
          "
        >
          {{ saveState === 'saving' ? '保存中…' : '保存' }}
        </button>
      </div>
    </div>

    <main class="story-role-edit-main">
      <section v-if="viewState === 'loading'" class="story-role-edit-not-found">
        <span>角色资料</span>
        <h1 id="story-role-edit-title">正在加载角色…</h1>
      </section>

      <div
        v-else-if="viewState === 'ready' && draft"
        class="story-role-edit-shell"
      >
        <header class="story-role-edit-header">
          <div>
            <span>{{ storyRoleCategoryLabel(draft.category) }} / 角色资料</span>
            <h1 id="story-role-edit-title">{{ draft.name }}</h1>
          </div>
          <p
            class="story-role-edit-save-state"
            :class="{
              'is-error': saveState === 'error' || saveState === 'conflict',
            }"
            role="status"
            aria-live="polite"
          >
            <template v-if="saveState === 'saved'">已保存到服务器</template>
            <template v-else-if="saveState === 'conflict'">
              角色已被其他操作修改，请重新加载后再保存
            </template>
            <template v-else-if="saveState === 'error'">
              操作失败，请检查网络后重试
            </template>
          </p>
        </header>

        <form
          id="story-role-edit-form"
          class="story-role-edit-form"
          @input="markChanged"
          @change="markChanged"
          @submit.prevent="saveRole"
        >
          <div class="story-role-edit-layout">
            <section
              class="story-role-cover-field"
              aria-labelledby="story-role-cover-title"
            >
              <div class="story-role-cover-preview" aria-live="polite">
                <img
                  v-if="coverPreviewUrl"
                  :src="coverPreviewUrl"
                  :alt="`${draft.name}封面图`"
                />
                <img
                  v-else
                  :src="storyRolePlaceholderUrl(draft.gender, storyEra)"
                  :alt="`${storyEra}时代${draft.name}默认占位图`"
                />
              </div>
              <div class="story-role-cover-controls">
                <span
                  id="story-role-cover-title"
                  class="story-role-cover-label"
                >
                  角色封面图
                </span>
                <p v-if="coverAssetFileName" class="story-role-cover-file-name">
                  {{ coverAssetFileName }}
                </p>
                <p class="story-role-cover-hint">
                  JPG、PNG 或 WebP，最大
                  20MB。上传完成后点击保存才会绑定到角色。
                </p>
                <div class="story-role-cover-actions">
                  <label
                    class="story-role-cover-upload"
                    for="story-role-cover-input"
                  >
                    {{
                      coverUploadState === 'uploading'
                        ? `上传中 ${coverUploadProgress}%`
                        : coverAssetId
                          ? '替换封面'
                          : '上传封面'
                    }}
                  </label>
                  <input
                    id="story-role-cover-input"
                    class="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    :disabled="
                      coverUploadState === 'uploading' ||
                      viewUploadState === 'uploading'
                    "
                    @change="selectCover"
                  />
                  <button
                    v-if="coverAssetId"
                    class="story-role-cover-remove"
                    type="button"
                    :disabled="
                      coverUploadState === 'uploading' ||
                      viewUploadState === 'uploading'
                    "
                    @click="removeCover"
                  >
                    移除
                  </button>
                </div>
                <progress
                  v-if="coverUploadState === 'uploading'"
                  class="story-role-cover-progress"
                  :value="coverUploadProgress"
                  max="100"
                >
                  {{ coverUploadProgress }}%
                </progress>
                <p
                  v-if="coverUploadError"
                  class="story-role-cover-error"
                  role="alert"
                >
                  {{ coverUploadError }}
                </p>
              </div>
            </section>

            <div class="story-role-edit-info">
              <section class="story-role-edit-section">
                <div class="story-role-edit-section-heading">
                  <div>
                    <span class="story-role-edit-section-kicker"
                      >01 / 基础信息</span
                    >
                    <h2>角色定位</h2>
                  </div>
                  <p>先确定角色在故事里的位置，再补充人物细节。</p>
                </div>
                <div class="story-role-edit-grid">
                  <label class="story-role-edit-field">
                    <span>叙事定位</span>
                    <select v-model="draft.category">
                      <option
                        v-for="option in storyRoleCategoryOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>

                  <label class="story-role-edit-field">
                    <span>角色名称</span>
                    <input
                      v-model="draft.name"
                      type="text"
                      maxlength="100"
                      required
                    />
                  </label>

                  <label class="story-role-edit-field">
                    <span>身份 / 职业</span>
                    <input
                      v-model="draft.occupation"
                      type="text"
                      maxlength="200"
                    />
                  </label>

                  <label class="story-role-edit-field">
                    <span>性别</span>
                    <select v-model="draft.gender">
                      <option
                        v-for="option in storyRoleGenderOptions"
                        :key="option"
                        :value="option"
                      >
                        {{ option }}
                      </option>
                    </select>
                  </label>

                  <label class="story-role-edit-field">
                    <span>当前阵营</span>
                    <select v-model="draft.camp">
                      <option
                        v-for="option in storyRoleCampOptions"
                        :key="option"
                        :value="option"
                      >
                        {{ option }}
                      </option>
                    </select>
                  </label>

                  <label class="story-role-edit-field">
                    <span>出场频率</span>
                    <select v-model="draft.appearanceFrequency">
                      <option
                        v-for="option in storyRoleAppearanceFrequencyOptions"
                        :key="option"
                        :value="option"
                      >
                        {{ option }}
                      </option>
                    </select>
                  </label>
                </div>
              </section>

              <section class="story-role-edit-section">
                <div class="story-role-edit-section-heading">
                  <div>
                    <span class="story-role-edit-section-kicker"
                      >02 / 人物特征</span
                    >
                    <h2>让角色有自己的选择</h2>
                  </div>
                  <p>填写可观察的性格、欲望、恐惧和变化，不只写抽象标签。</p>
                </div>

                <label class="story-role-edit-field is-wide">
                  <span>性格内核</span>
                  <textarea
                    v-model="draft.personalityCore"
                    rows="4"
                    maxlength="2000"
                    placeholder="核心性格、价值观、致命缺陷和人物反差"
                  ></textarea>
                </label>

                <label class="story-role-edit-field is-wide">
                  <span>核心动机与矛盾</span>
                  <textarea
                    v-model="draft.motivationConflict"
                    rows="5"
                    maxlength="4000"
                    placeholder="他想得到什么？真正需要什么？害怕什么？哪些底线不会跨越？"
                  ></textarea>
                </label>
                <label class="story-role-edit-field is-wide">
                  <span>与主线关系</span>
                  <textarea
                    v-model="draft.mainlineRelation"
                    rows="5"
                    maxlength="8000"
                    placeholder="他与主线事件、主角和核心冲突的关系，以及制造阻碍、提供线索等剧情作用"
                  ></textarea>
                </label>
              </section>

              <section
                class="story-role-edit-section story-role-edit-advanced-config"
              >
                <button
                  class="story-role-edit-advanced-toggle"
                  type="button"
                  :aria-expanded="advancedConfigExpanded"
                  aria-controls="story-role-edit-advanced-content"
                  @click="advancedConfigExpanded = !advancedConfigExpanded"
                >
                  <span class="story-role-edit-advanced-toggle-copy">
                    <span class="story-role-edit-section-kicker"
                      >03 / 人物深层特质</span
                    >
                    <span
                      class="story-role-edit-advanced-title"
                      role="heading"
                      aria-level="2"
                    >
                      高级配置
                    </span>
                    <span class="story-role-edit-advanced-description">
                      描述角色平时怎么说话；具体场景的情绪可以临时改变这些默认习惯。
                    </span>
                  </span>
                  <span
                    class="story-role-edit-advanced-toggle-indicator"
                    aria-hidden="true"
                  >
                    {{ advancedConfigExpanded ? '收起' : '展开' }}
                  </span>
                </button>

                <div
                  v-show="advancedConfigExpanded"
                  id="story-role-edit-advanced-content"
                  class="story-role-edit-advanced-content"
                >
                  <label class="story-role-edit-field is-wide">
                    <span>说话方式</span>
                    <textarea
                      v-model="draft.speechProfile.style"
                      rows="5"
                      maxlength="2000"
                      placeholder="直接描述语速、句式、语气、用词，以及脏话、玩梗、比喻、结巴等习惯。"
                    ></textarea>
                  </label>

                  <div class="story-role-edit-repeatable">
                    <div class="story-role-edit-repeatable-heading">
                      <div>
                        <span>表达习惯</span>
                        <small
                          >一条写清一个习惯，必要时补充频率、触发条件和例外。</small
                        >
                      </div>
                      <button type="button" @click="addSpeechHabit">
                        添加习惯
                      </button>
                    </div>
                    <article
                      v-for="(habit, index) in draft.speechProfile.habits"
                      :key="`habit-${index}`"
                      class="story-role-edit-repeatable-card"
                    >
                      <div class="story-role-edit-repeatable-card-header">
                        <strong>习惯 {{ index + 1 }}</strong>
                        <button type="button" @click="removeSpeechHabit(index)">
                          移除
                        </button>
                      </div>
                      <label class="story-role-edit-field is-wide">
                        <span>习惯描述</span>
                        <textarea
                          v-model="draft.speechProfile.habits[index]"
                          rows="2"
                          maxlength="500"
                          required
                          placeholder="例如：紧张时会在句首重复第一个字，但面对下属时不会。"
                        ></textarea>
                      </label>
                    </article>
                    <p
                      v-if="!draft.speechProfile.habits.length"
                      class="story-role-edit-empty"
                    >
                      还没有添加表达习惯。
                    </p>
                  </div>

                  <div class="story-role-edit-repeatable">
                    <div class="story-role-edit-repeatable-heading">
                      <div>
                        <span>典型台词</span>
                        <small>写 2～3 条带情境的代表性台词即可。</small>
                      </div>
                      <button type="button" @click="addDialogueExample">
                        添加台词
                      </button>
                    </div>
                    <article
                      v-for="(example, index) in draft.speechProfile
                        .dialogueExamples"
                      :key="`dialogue-${index}`"
                      class="story-role-edit-repeatable-card"
                    >
                      <div class="story-role-edit-repeatable-card-header">
                        <strong>台词 {{ index + 1 }}</strong>
                        <button
                          type="button"
                          @click="removeDialogueExample(index)"
                        >
                          移除
                        </button>
                      </div>
                      <label class="story-role-edit-field is-wide">
                        <span>情境</span>
                        <input
                          v-model="example.context"
                          type="text"
                          maxlength="300"
                          placeholder="例如：被朋友拆穿、需要拒绝上级时"
                        />
                      </label>
                      <label class="story-role-edit-field is-wide">
                        <span>台词</span>
                        <textarea
                          v-model="example.line"
                          rows="2"
                          maxlength="500"
                          required
                        ></textarea>
                      </label>
                    </article>
                    <p
                      v-if="!draft.speechProfile.dialogueExamples.length"
                      class="story-role-edit-empty"
                    >
                      还没有添加典型台词。
                    </p>
                  </div>

                  <section
                    class="story-role-view-field"
                    aria-labelledby="story-role-view-title"
                  >
                    <div class="story-role-view-heading">
                      <div>
                        <span
                          id="story-role-view-title"
                          class="story-role-edit-section-kicker"
                        >
                          人物视图
                        </span>
                        <p>用一张横向画面补充角色的视觉印象。</p>
                      </div>
                      <span class="story-role-view-ratio">16 : 9</span>
                    </div>

                    <div class="story-role-view-preview" aria-live="polite">
                      <img
                        v-if="viewPreviewUrl"
                        :src="viewPreviewUrl"
                        :alt="`${draft.name}人物视图`"
                      />
                      <span v-else>尚未上传人物视图</span>
                    </div>

                    <p
                      v-if="viewAssetFileName"
                      class="story-role-view-file-name"
                    >
                      {{ viewAssetFileName }}
                    </p>
                    <p class="story-role-view-hint">
                      JPG、PNG 或 WebP，最大
                      20MB。上传完成后点击保存才会绑定到角色。
                    </p>

                    <div class="story-role-view-actions">
                      <label
                        class="story-role-view-upload"
                        for="story-role-view-input"
                      >
                        {{
                          viewUploadState === 'uploading'
                            ? `上传中 ${viewUploadProgress}%`
                            : viewAssetId
                              ? '替换人物视图'
                              : '上传人物视图'
                        }}
                      </label>
                      <input
                        id="story-role-view-input"
                        class="sr-only"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        :disabled="
                          coverUploadState === 'uploading' ||
                          viewUploadState === 'uploading'
                        "
                        @change="selectView"
                      />
                      <button
                        v-if="viewAssetId"
                        class="story-role-view-remove"
                        type="button"
                        :disabled="
                          coverUploadState === 'uploading' ||
                          viewUploadState === 'uploading'
                        "
                        @click="removeView"
                      >
                        移除
                      </button>
                    </div>

                    <progress
                      v-if="viewUploadState === 'uploading'"
                      class="story-role-view-progress"
                      :value="viewUploadProgress"
                      max="100"
                    >
                      {{ viewUploadProgress }}%
                    </progress>
                    <p
                      v-if="viewUploadError"
                      class="story-role-view-error"
                      role="alert"
                    >
                      {{ viewUploadError }}
                    </p>
                  </section>
                </div>
              </section>
            </div>
          </div>

          <div class="story-role-edit-actions">
            <RouterLink :to="rolesLocation">取消</RouterLink>
            <button
              type="submit"
              :disabled="
                saveState === 'saving' ||
                coverUploadState === 'uploading' ||
                viewUploadState === 'uploading'
              "
            >
              {{
                viewUploadState === 'uploading'
                  ? '人物视图上传中…'
                  : coverUploadState === 'uploading'
                    ? '封面上传中…'
                    : saveState === 'saving'
                      ? '保存中…'
                      : '保存角色'
              }}
            </button>
          </div>
        </form>
      </div>

      <section v-else class="story-role-edit-not-found">
        <span>角色资料</span>
        <h1 id="story-role-edit-title">
          {{ viewState === 'not-found' ? '没有找到这个角色' : '角色加载失败' }}
        </h1>
        <p>
          {{
            viewState === 'not-found'
              ? '这个角色可能已被归档，或者链接有误。'
              : '无法连接到角色资产服务，请稍后重试。'
          }}
        </p>
        <button v-if="viewState === 'error'" type="button" @click="loadRole">
          重新加载
        </button>
        <RouterLink :to="rolesLocation">返回角色资产</RouterLink>
      </section>
    </main>
  </section>
</template>
