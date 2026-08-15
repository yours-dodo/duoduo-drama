<script setup lang="ts">
import { ref, watch } from 'vue';

import {
  OUTLINE_NODE_TYPE_LABELS,
  type OutlineNode,
  type OutlineNodeType,
} from './story-outline-types';

const props = defineProps<{
  open: boolean;
  mode: 'create' | 'edit';
  node: OutlineNode | null;
}>();

const emit = defineEmits<{
  save: [payload: { title: string; summary: string; type: OutlineNodeType }];
  cancel: [];
  delete: [];
}>();

const title = ref('');
const summary = ref('');
const type = ref<OutlineNodeType>('event');
const errorMessage = ref('');

function syncDraft() {
  title.value = props.node?.title ?? '';
  summary.value = props.node?.summary ?? '';
  type.value = props.node?.type ?? 'event';
  errorMessage.value = '';
}

watch(
  () => [props.open, props.mode, props.node?.id] as const,
  syncDraft,
  { immediate: true },
);

function submit() {
  const nextTitle = title.value.trim();
  if (!nextTitle) {
    errorMessage.value = '请先填写节点标题。';
    return;
  }

  errorMessage.value = '';
  emit('save', {
    title: nextTitle,
    summary: summary.value.trim(),
    type: type.value,
  });
}
</script>

<template>
  <aside v-if="open" class="story-outline-node-editor" aria-label="编辑大纲节点">
    <div class="story-outline-node-editor-header">
      <div>
        <span class="story-outline-kicker">{{ mode === 'create' ? '新增节点' : '编辑节点' }}</span>
        <h3>{{ mode === 'create' ? '把想法放进结构里' : '调整节点内容' }}</h3>
      </div>
      <button
        class="story-outline-icon-button"
        type="button"
        aria-label="关闭节点编辑器"
        title="关闭"
        @click="emit('cancel')"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>

    <form class="story-outline-node-form" @submit.prevent="submit">
      <label>
        <span>标题</span>
        <input v-model="title" type="text" maxlength="80" autofocus />
      </label>

      <label>
        <span>摘要</span>
        <textarea v-model="summary" rows="4" maxlength="240"></textarea>
      </label>

      <fieldset>
        <legend>节点类型</legend>
        <label v-for="(label, value) in OUTLINE_NODE_TYPE_LABELS" :key="value" class="story-outline-type-option">
          <input v-model="type" type="radio" name="outline-node-type" :value="value" />
          <span>{{ label }}</span>
        </label>
      </fieldset>

      <p v-if="errorMessage" class="story-outline-form-error" role="alert">
        {{ errorMessage }}
      </p>

      <div class="story-outline-node-editor-actions">
        <button v-if="mode === 'edit'" class="story-outline-danger-button" type="button" @click="emit('delete')">
          删除节点
        </button>
        <span></span>
        <button class="story-outline-secondary-button" type="button" @click="emit('cancel')">
          取消
        </button>
        <button class="story-outline-primary-button" type="submit">
          {{ mode === 'create' ? '加入大纲' : '保存修改' }}
        </button>
      </div>
    </form>
  </aside>
</template>
