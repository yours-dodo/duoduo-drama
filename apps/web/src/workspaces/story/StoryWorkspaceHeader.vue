<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

const route = useRoute();
const theme = ref<'light' | 'dark'>('dark');
const helpOpen = ref(false);
const isFullscreen = ref(false);

const storyModules = [
  { key: 'worldview', label: '世界观' },
  { key: 'roles', label: '角色资产' },
  { key: 'outline', label: '大纲' },
  { key: 'story', label: '故事正文' },
] as const;

const isProjectRoute = computed(() => route.meta.page === 'project');
const isImmersiveRoute = computed(() => route.meta.mode === 'immersive');
const projectId = computed(() => String(route.params.projectId ?? ''));
const moduleBasePath = computed(() =>
  isImmersiveRoute.value
    ? `/immersive/${encodeURIComponent(projectId.value)}`
    : `/${encodeURIComponent(projectId.value)}`,
);
const currentModule = computed(() => String(route.params.module ?? 'outline'));

function readSavedTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  try {
    const savedTheme = window.localStorage.getItem('duoduo-theme');
    return savedTheme === 'light' ? 'light' : 'dark';
  } catch {
    return document.documentElement.dataset.storyTheme === 'light'
      ? 'light'
      : 'dark';
  }
}

function applyTheme(nextTheme: 'light' | 'dark') {
  theme.value = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.dataset.storyTheme = nextTheme;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  metaTheme?.setAttribute('content', nextTheme === 'light' ? '#F5F5F3' : '#080808');
  try {
    window.localStorage.setItem('duoduo-theme', nextTheme);
    window.localStorage.setItem('duoduo-story-theme', nextTheme);
  } catch {
    // Keep the in-memory theme when storage is unavailable.
  }
}

function toggleTheme() {
  applyTheme(theme.value === 'light' ? 'dark' : 'light');
}

function updateFullscreenState() {
  isFullscreen.value = Boolean(document.fullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    updateFullscreenState();
  }
}

function closeHelpMenu() {
  helpOpen.value = false;
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const helpRoot = document.querySelector('.story-header-help');
  if (!helpRoot?.contains(target)) closeHelpMenu();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeHelpMenu();
}

onMounted(() => {
  theme.value = readSavedTheme();
  applyTheme(theme.value);
  document.addEventListener('fullscreenchange', updateFullscreenState);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', updateFullscreenState);
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <header class="site-header">
    <a class="brand" href="/" aria-label="多多故事台首页">
      <span class="brand-mark" aria-hidden="true">多</span>
      <span>多多故事台</span>
    </a>

    <nav
      v-if="isProjectRoute"
      class="story-header-module-nav"
      aria-label="故事编辑目录"
    >
      <RouterLink
        v-for="item in storyModules"
        :key="item.key"
        class="story-header-module-link"
        :class="{ 'is-active': currentModule === item.key }"
        :to="`${moduleBasePath}/${item.key}`"
        :aria-current="currentModule === item.key ? 'page' : undefined"
      >
        {{ item.label }}
      </RouterLink>
    </nav>

    <div class="story-header-tools" aria-label="故事工作区工具">
      <nav v-if="!isProjectRoute" class="story-header-nav" aria-label="故事工作区导航">
        <a href="/dramas">短剧工作台</a>
        <a href="/works">作品广场</a>
        <a href="/collaboration">联合创作</a>
      </nav>

      <button
        class="story-header-tool"
        type="button"
        :aria-label="theme === 'light' ? '切换深色主题' : '切换浅色主题'"
        :title="theme === 'light' ? '切换深色主题' : '切换浅色主题'"
        @click="toggleTheme"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
          <circle cx="10" cy="10" r="3.2" stroke="currentColor" stroke-width="1.4" />
          <path d="M10 2.2v2M10 15.8v2M17.8 10h-2M4.2 10h-2M15.5 4.5l-1.4 1.4M5.9 14.1l-1.4 1.4M15.5 15.5l-1.4-1.4M5.9 5.9 4.5 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
        <span class="sr-only">切换主题色</span>
      </button>

      <button
        class="story-header-tool"
        type="button"
        :aria-label="isFullscreen ? '退出全屏展示' : '全屏展示'"
        :aria-pressed="isFullscreen"
        :title="isFullscreen ? '退出全屏展示' : '全屏展示'"
        @click="toggleFullscreen"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
          <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M3 13v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span class="sr-only">全屏展示</span>
      </button>

      <div class="story-header-help">
        <button
          class="story-header-tool"
          type="button"
          aria-label="系统教程"
          aria-controls="story-help-menu"
          :aria-expanded="helpOpen"
          title="系统教程"
          @click.stop="helpOpen = !helpOpen"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
            <circle cx="10" cy="10" r="7.2" stroke="currentColor" stroke-width="1.4" />
            <path d="M7.9 7.6a2.2 2.2 0 1 1 3.4 1.8c-.8.5-1.3.9-1.3 1.8M10 14.4v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
          <span class="sr-only">系统教程</span>
        </button>
        <div
          id="story-help-menu"
          class="story-help-menu"
          role="menu"
          aria-label="系统教程菜单"
          :hidden="!helpOpen"
        >
          <button class="story-help-menu-item" type="button" role="menuitem" @click="closeHelpMenu">
            系统教程
          </button>
          <button class="story-help-menu-item" type="button" role="menuitem" @click="closeHelpMenu">
            基础知识学习
          </button>
        </div>
      </div>
    </div>
  </header>
</template>
