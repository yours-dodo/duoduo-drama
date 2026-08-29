<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import {
  generateStoryProjectTags,
  getPersonalStoryProject,
  getStoryProject,
  updatePersonalStoryProject,
  updateStoryProject,
  type StoryProject,
  type StoryProjectEra,
} from '../../../../api/story-api';

const route = useRoute();
const projectId = computed(() => String(route.params.projectId ?? ''));
const teamId = computed(() => {
  const value = route.query.teamId;
  return typeof value === 'string' && value ? value : null;
});

const storyName = ref('');
const storyDescription = ref('');
const era = ref<StoryProjectEra>('现代');
const tags = ref<string[]>([]);
const newTag = ref('');
const revision = ref(1);
const viewState = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const saveState = ref<'idle' | 'saving' | 'saved'>('idle');
const tagState = ref<'idle' | 'generating'>('idle');

watch(
  () => [projectId.value, teamId.value],
  () => {
    void loadProject();
  },
  { immediate: true },
);

async function loadProject() {
  if (!projectId.value) return;
  viewState.value = 'loading';
  errorMessage.value = '';
  try {
    const response = teamId.value
      ? await getStoryProject(teamId.value, projectId.value)
      : await getPersonalStoryProject(projectId.value);
    applyProject(response.project);
    viewState.value = 'ready';
  } catch {
    viewState.value = 'error';
    errorMessage.value = '故事基础信息加载失败，请检查网络后重试。';
  }
}

function applyProject(project: StoryProject) {
  storyName.value = project.title;
  storyDescription.value = project.description ?? '';
  era.value = project.era === '古代' ? '古代' : '现代';
  tags.value = [...(project.tags ?? [])];
  revision.value = project.revision;
}

function addTag() {
  const value = newTag.value.trim();
  if (!value || tags.value.includes(value) || tags.value.length >= 16) return;
  tags.value = [...tags.value, value];
  newTag.value = '';
  saveState.value = 'idle';
}

function removeTag(tag: string) {
  tags.value = tags.value.filter((item) => item !== tag);
  saveState.value = 'idle';
}

function markDirty() {
  if (saveState.value === 'saved') saveState.value = 'idle';
}

async function saveBasicInfo() {
  if (saveState.value === 'saving' || viewState.value !== 'ready') return;
  saveState.value = 'saving';
  errorMessage.value = '';
  try {
    const input = {
      title: storyName.value,
      description: storyDescription.value,
      era: era.value,
      tags: tags.value,
      expectedRevision: revision.value,
    };
    const response = teamId.value
      ? await updateStoryProject(teamId.value, projectId.value, input)
      : await updatePersonalStoryProject(projectId.value, input);
    applyProject(response.project);
    saveState.value = 'saved';
    window.setTimeout(() => {
      if (saveState.value === 'saved') saveState.value = 'idle';
    }, 1800);
  } catch {
    saveState.value = 'idle';
    errorMessage.value =
      '保存失败，可能是内容已被其他人修改，请重新加载后重试。';
  }
}

async function summarizeTags() {
  if (tagState.value === 'generating' || viewState.value !== 'ready') return;
  if (!storyDescription.value.trim()) {
    errorMessage.value = '请先填写故事描述，再让 AI 总结标签。';
    return;
  }
  tagState.value = 'generating';
  errorMessage.value = '';
  try {
    const response = await generateStoryProjectTags(
      teamId.value,
      projectId.value,
      {
        title: storyName.value,
        description: storyDescription.value,
        expectedRevision: revision.value,
      },
    );
    applyProject(response.project);
  } catch {
    errorMessage.value = 'AI 标签总结失败，请稍后重试。';
  } finally {
    tagState.value = 'idle';
  }
}
</script>

<template>
  <section class="story-basic-info-workspace" aria-label="基础信息表单">
    <div
      v-if="viewState === 'loading'"
      class="story-basic-info-state"
      role="status"
    >
      正在加载故事基础信息…
    </div>
    <div v-else-if="viewState === 'error'" class="story-basic-info-state">
      <p>{{ errorMessage }}</p>
      <button type="button" @click="loadProject">重新加载</button>
    </div>

    <form
      v-else
      id="story-basic-info-form"
      class="story-basic-info-layout"
      @submit.prevent="saveBasicInfo"
    >
      <div class="story-basic-info-form">
        <label class="story-basic-info-field">
          <span>故事名</span>
          <input
            v-model="storyName"
            type="text"
            maxlength="200"
            placeholder="给这个故事一个名字"
            @input="markDirty"
          />
        </label>

        <label
          class="story-basic-info-field story-basic-info-field-description"
        >
          <span>故事描述</span>
          <textarea
            v-model="storyDescription"
            rows="7"
            maxlength="2000"
            placeholder="用几句话描述这个故事想讲什么。"
            @input="markDirty"
          ></textarea>
        </label>

        <section
          class="story-basic-info-tags"
          aria-labelledby="story-basic-info-tags-title"
        >
          <div class="story-basic-info-tags-heading">
            <div>
              <span class="story-basic-info-field-label">故事标签</span>
              <p id="story-basic-info-tags-title">
                时代是必选标签，只能在现代与古代之间切换。
              </p>
            </div>
            <button
              class="story-basic-info-ai-button"
              type="button"
              :disabled="tagState === 'generating'"
              @click="summarizeTags"
            >
              {{ tagState === 'generating' ? '总结中…' : 'AI 总结标签' }}
            </button>
          </div>

          <div class="story-basic-info-era" role="group" aria-label="故事时代">
            <span class="story-basic-info-era-label">时代</span>
            <button
              v-for="option in ['现代', '古代'] as StoryProjectEra[]"
              :key="option"
              class="story-basic-info-era-option"
              :class="{ 'is-active': era === option }"
              type="button"
              :aria-pressed="era === option"
              @click="
                era = option;
                markDirty();
              "
            >
              {{ option }}
            </button>
          </div>

          <div class="story-basic-info-tag-list" aria-live="polite">
            <span v-for="tag in tags" :key="tag" class="story-basic-info-tag">
              {{ tag }}
              <button
                type="button"
                :aria-label="`删除标签：${tag}`"
                @click="removeTag(tag)"
              >
                ×
              </button>
            </span>
            <span v-if="tags.length === 0" class="story-basic-info-tag-empty"
              >还没有内容标签</span
            >
          </div>

          <div class="story-basic-info-tag-add">
            <input
              v-model="newTag"
              type="text"
              maxlength="50"
              placeholder="添加内容标签"
              @keydown.enter.prevent="addTag"
            />
            <button
              type="button"
              :disabled="!newTag.trim() || tags.length >= 16"
              @click="addTag"
            >
              添加
            </button>
          </div>
        </section>

        <p v-if="errorMessage" class="story-basic-info-error" role="alert">
          {{ errorMessage }}
        </p>
      </div>

      <aside
        class="story-basic-info-cover-card"
        aria-label="故事封面占位，上传功能暂未开放"
      >
        <div class="story-basic-info-cover-placeholder">
          <span class="story-basic-info-cover-plus" aria-hidden="true">+</span>
          <strong>故事封面</strong>
          <span>上传封面图片</span>
        </div>
      </aside>
    </form>
  </section>
</template>
