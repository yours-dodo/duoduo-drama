<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import { isStoryModule, type StoryModule } from './router';
import StoryBasicInfoWorkspace from './StoryBasicInfoWorkspace.vue';
import StoryOutlineWorkspace from './StoryOutlineWorkspace.vue';
import StoryRolesWorkspace from './StoryRolesWorkspace.vue';
import StoryStoryWorkspace from './StoryStoryWorkspace.vue';
import StoryWorldviewWorkspace from './StoryWorldviewWorkspace.vue';

type StoryModuleDefinition = {
  label: string;
  description: string;
  workspaceTitle: string;
  workspaceDescription: string;
  focus: readonly string[];
  relationLabel: string;
  relation: string;
};

const route = useRoute();

const moduleDefinitions: Record<StoryModule, StoryModuleDefinition> = {
  basic: {
    label: '故事基础信息',
    description: '集中确认故事的标题、类型和核心表达，为后续资产建立统一的创作方向。',
    workspaceTitle: '故事基础信息',
    workspaceDescription: '先把故事是什么、写给谁以及想表达什么说清楚，再开始组织世界观、角色和情节。',
    focus: ['故事标题与一句话概念', '题材、类型与目标读者', '故事简介和核心表达'],
    relationLabel: '项目起点',
    relation: '为世界观、角色资产、大纲和正文提供统一的故事方向。',
  },
  worldview: {
    label: '世界观',
    description: '建立故事成立的边界，让人物行动和事件推进有据可依。',
    workspaceTitle: '世界观底稿',
    workspaceDescription: '从规则、空间和历史开始，沉淀一个可以持续引用的故事世界。',
    focus: ['核心规则与限制', '时代、空间与社会背景', '可被角色和大纲引用的设定'],
    relationLabel: '基础资产',
    relation: '为角色资产和大纲提供故事边界。',
  },
  roles: {
    label: '角色资产',
    description: '整理推动故事的人物、关系和每一次关键选择。',
    workspaceTitle: '角色资产库',
    workspaceDescription: '把人物目标、动机与变化整理成可以被故事持续调用的资产。',
    focus: ['人物目标与内在动机', '角色关系与冲突位置', '角色在故事中的变化方向'],
    relationLabel: '动力资产',
    relation: '让世界观中的规则转化为人物行动。',
  },
  outline: {
    label: '大纲',
    description: '把世界观与角色组织成连续、可推进的故事结构。',
    workspaceTitle: '故事结构底稿',
    workspaceDescription: '先确认故事核心、冲突关系和事件因果，再逐步推进到正文生产。',
    focus: ['故事核心与推进方向', '主要事件与因果关系', '角色目标与冲突推进'],
    relationLabel: '结构资产',
    relation: '把世界边界和人物动力编排成可执行的故事路径。',
  },
  story: {
    label: '故事正文',
    description: '将已经确认的结构推进为可阅读、可迭代的故事内容。',
    workspaceTitle: '正文生产区',
    workspaceDescription: '从已确认的结构出发，持续编辑内容、接收反馈并保留每次版本。',
    focus: ['连续内容的组织', '段落级编辑与反馈', '版本结果的持续迭代'],
    relationLabel: '生产结果',
    relation: '承接大纲的推进，将结构转化为可阅读的正文。',
  },
};

const currentModule = computed<StoryModule>(() => {
  const value = String(route.params.module ?? 'outline');
  return isStoryModule(value) ? value : 'outline';
});
const currentTitleId = computed(() => {
  if (currentModule.value === 'outline') return 'story-outline-workspace-title';
  if (currentModule.value === 'roles') return 'story-roles-workspace-title';
  if (currentModule.value === 'worldview') return 'story-worldview-workspace-title';
  if (currentModule.value === 'story') return 'story-story-workspace-title';
  if (currentModule.value === 'basic') return 'story-basic-info-workspace-title';
  return `story-project-${currentModule.value}-title`;
});
const currentDefinition = computed(() => moduleDefinitions[currentModule.value]);
const modeLabel = computed(() =>
  route.meta.mode === 'immersive' ? '沉浸式项目' : '故事项目',
);
const importPending = computed(
  () => route.query.import === 'pending' && currentModule.value === 'outline',
);
</script>

<template>
  <section
    class="story-project-route"
    :aria-labelledby="currentTitleId"
  >
    <div class="story-project-content-toolbar">
      <RouterLink
        class="story-project-back-link"
        to="/"
        aria-label="回到创作空间"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
          <path
            d="M8.2 4.2 2.8 10l5.4 5.8M3.2 10h14"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>回到创作空间</span>
      </RouterLink>

      <div class="story-project-toolbar-actions" aria-label="项目操作">
        <button class="story-project-toolbar-action" type="button" disabled title="即将开放">
          保存
        </button>
        <button class="story-project-toolbar-action" type="button" disabled title="即将开放">
          导出
        </button>
      </div>
    </div>

    <div class="story-project-module-main">
      <StoryBasicInfoWorkspace v-if="currentModule === 'basic'" />
      <StoryWorldviewWorkspace v-else-if="currentModule === 'worldview'" />
      <StoryRolesWorkspace v-else-if="currentModule === 'roles'" />
      <StoryOutlineWorkspace v-else-if="currentModule === 'outline'" />
      <StoryStoryWorkspace v-else-if="currentModule === 'story'" />

      <template v-else>
        <header class="story-asset-intro">
          <div class="story-asset-intro-copy">
            <span class="story-asset-eyebrow">{{ modeLabel }} / 项目资产</span>
            <h1 :id="`story-project-${currentModule}-title`">
              {{ currentDefinition.label }}
            </h1>
            <p>{{ currentDefinition.description }}</p>
          </div>
        </header>

        <div class="story-asset-workspace">
          <section
            class="story-asset-main-panel"
            :aria-label="`${currentDefinition.label}内容区`"
          >
            <div class="story-asset-panel-heading">
              <div>
                <span class="story-asset-panel-kicker">当前模块</span>
                <h2>{{ currentDefinition.workspaceTitle }}</h2>
              </div>
              <span class="story-asset-panel-state">编辑空间</span>
            </div>

            <p class="story-asset-workspace-description">
              {{ currentDefinition.workspaceDescription }}
            </p>

            <div class="story-asset-focus-list">
              <div
                v-for="item in currentDefinition.focus"
                :key="item"
                class="story-asset-focus-item"
              >
                <span class="story-asset-focus-mark" aria-hidden="true"></span>
                <span>{{ item }}</span>
              </div>
            </div>

            <p v-if="importPending" class="story-asset-import-status" role="status">
              故事导入任务已建立，等待文件上传与解析。
            </p>
          </section>

          <aside class="story-asset-context" aria-label="资产关系">
            <span class="story-asset-context-kicker">生产关系</span>
            <strong>{{ currentDefinition.relationLabel }}</strong>
            <p>{{ currentDefinition.relation }}</p>
          </aside>
        </div>
      </template>
    </div>
  </section>
</template>
