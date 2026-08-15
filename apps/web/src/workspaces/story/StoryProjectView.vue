<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { isStoryModule, type StoryModule } from './router';

const route = useRoute();

const moduleLabels: Record<StoryModule, string> = {
  outline: '大纲',
  roles: '角色资产',
  worldview: '设定',
  story: '故事',
};

const moduleDescriptions: Record<StoryModule, string> = {
  outline: '从故事骨架开始，整理主线、章节和推进节奏。',
  roles: '集中维护角色关系、人物动机和可复用的角色资产。',
  worldview: '沉淀故事发生所需的世界规则、空间与背景设定。',
  story: '进入故事生产，把设定和结构推进为可阅读的正文。',
};

const currentModule = computed<StoryModule>(() => {
  const value = String(route.params.module ?? 'outline');
  return isStoryModule(value) ? value : 'outline';
});
const modeLabel = computed(() =>
  route.meta.mode === 'immersive' ? '沉浸式创作' : '故事创建',
);
const projectId = computed(() => String(route.params.projectId ?? ''));
const importPending = computed(
  () => route.query.import === 'pending' && currentModule.value === 'outline',
);
</script>

<template>
  <section
    class="story-project-route"
    aria-labelledby="story-project-module-title"
  >
    <div class="story-project-module-main">
      <header class="story-subroute-header">
        <span class="story-subroute-index">{{ modeLabel }}</span>
        <h1 id="story-project-module-title">{{ moduleLabels[currentModule] }}</h1>
        <p>{{ moduleDescriptions[currentModule] }}</p>
      </header>

      <section
        class="story-subroute-panel"
        :aria-label="`${moduleLabels[currentModule]}内容`"
      >
        <span class="story-subroute-kicker">{{ modeLabel }}</span>
        <h2>{{ moduleLabels[currentModule] }}</h2>
        <p v-if="importPending" role="status">
          故事导入任务已建立，等待文件上传与解析。
        </p>
        <p v-else>{{ moduleDescriptions[currentModule] }}</p>
        <span class="story-project-route-id">{{ projectId }}</span>
      </section>
    </div>
  </section>
</template>
