<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

type RecentConversation = {
  id: string;
  projectId: string;
  title: string;
  updatedAt: number;
};

const route = useRoute();
const sidebarCollapsed = ref(false);
const recentExpanded = ref(true);
const recentPopoverOpen = ref(false);
const recentConversations = ref<RecentConversation[]>([]);
const userEmail = ref('读取中…');
const userInitial = ref('U');

const navigation = [
  { href: '/stories', label: '创作空间' },
  { href: '/stories/immersive', label: '沉浸式创作' },
  { href: '/stories/templates', label: '模版库' },
];

const activePath = computed(() => {
  if (route.path === '/stories') return '/stories';
  if (route.path === '/stories/immersive') return '/stories/immersive';
  if (route.path === '/stories/templates') return '/stories/templates';
  return '';
});

const recentStorageKey = 'duoduo-story-recent-conversations';
const sidebarStorageKey = 'duoduo-story-sidebar';

function readRecentConversations() {
  try {
    const value = JSON.parse(window.localStorage.getItem(recentStorageKey) ?? '[]');
    recentConversations.value = Array.isArray(value)
      ? value.filter(
          (item): item is RecentConversation =>
            typeof item?.id === 'string' &&
            typeof item?.projectId === 'string' &&
            typeof item?.title === 'string' &&
            typeof item?.updatedAt === 'number',
        )
      : [];
  } catch {
    recentConversations.value = [];
  }
}

function applySidebarState(collapsed: boolean) {
  sidebarCollapsed.value = collapsed;
  document.documentElement.dataset.storySidebar = collapsed ? 'collapsed' : 'expanded';
}

function toggleSidebar() {
  applySidebarState(!sidebarCollapsed.value);
  try {
    window.localStorage.setItem(
      sidebarStorageKey,
      sidebarCollapsed.value ? 'collapsed' : 'expanded',
    );
  } catch {
    // Keep the in-memory state when storage is unavailable.
  }
}

function toggleRecent() {
  recentExpanded.value = !recentExpanded.value;
}

function toggleRecentPopover() {
  recentPopoverOpen.value = !recentPopoverOpen.value;
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  const recentRoot = document.querySelector('.story-floating-recent-collapsed');
  if (!recentRoot?.contains(target)) recentPopoverOpen.value = false;
}

function handleStorage(event: StorageEvent) {
  if (event.key === recentStorageKey) readRecentConversations();
}

async function loadUser() {
  try {
    const response = await fetch('/api/v1/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { user?: { email?: string } };
    const email = payload.user?.email?.trim();
    if (!email) return;
    userEmail.value = email;
    userInitial.value = email.slice(0, 1).toUpperCase();
  } catch {
    // The sidebar remains usable when the convenience user lookup fails.
  }
}

onMounted(() => {
  let collapsed = document.documentElement.dataset.storySidebar === 'collapsed';
  try {
    collapsed = window.localStorage.getItem(sidebarStorageKey) === 'collapsed';
  } catch {
    // Keep the head-applied state when storage is unavailable.
  }
  applySidebarState(collapsed);
  readRecentConversations();
  void loadUser();
  window.addEventListener('storage', handleStorage);
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  window.removeEventListener('storage', handleStorage);
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<template>
  <aside class="story-floating-sidebar" :class="{ 'is-collapsed': sidebarCollapsed }" aria-label="故事工作区功能导航">
    <div class="story-floating-sidebar-top">
      <span class="story-floating-sidebar-trigger">
        <span class="story-floating-sidebar-logo" aria-hidden="true">多</span>
      </span>
      <button
        class="story-floating-sidebar-toggle"
        type="button"
        :aria-expanded="!sidebarCollapsed"
        :aria-label="sidebarCollapsed ? '展开导航栏' : '折叠导航栏'"
        :title="sidebarCollapsed ? '展开导航栏' : '折叠导航栏'"
        @click="toggleSidebar"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M9.67272 0.522841C10.8339 0.522841 11.76 0.522714 12.4963 0.602493C13.2453 0.683657 13.8789 0.854248 14.4264 1.25197C14.7504 1.48739 15.0355 1.77247 15.2709 2.0965C15.6686 2.64394 15.8392 3.27758 15.9204 4.02655C16.0002 4.7629 16 5.68895 16 6.85014V9.14986C16 10.3111 16.0002 11.2371 15.9204 11.9735C15.8392 12.7224 15.6686 13.3561 15.2709 13.9035C15.0355 14.2275 14.7504 14.5126 14.4264 14.748C13.8789 15.1458 13.2453 15.3163 12.4963 15.3975C11.76 15.4773 10.8339 15.4772 9.67272 15.4772H6.3273C5.16611 15.4772 4.24006 15.4773 3.50371 15.3975C2.75474 15.3163 2.1211 15.1458 1.57366 14.748C1.24963 14.5126 0.964549 14.2275 0.729131 13.9035C0.331407 13.3561 0.160817 12.7224 0.0796529 11.9735C-0.000126137 11.2371 0.000126137 10.3111 0.0796529 4.02655C0.160817 3.27758 0.331407 2.64394 0.729131 2.0965C0.964549 1.77247 1.24963 1.48739 1.57366 1.25197C2.1211 0.854248 2.75474 0.683657 3.50371 0.602493C4.24006 0.522714 5.16611 0.522841 6.3273 0.522841H9.67272ZM5.54303 1.88715V14.1118C5.78636 14.1128 6.04709 14.1169 6.3273 14.1169H9.67272C10.8639 14.1169 11.7032 14.1164 12.3493 14.0465C12.9824 13.9779 13.3497 13.8494 13.6268 13.6482C13.8354 13.4966 14.0195 13.3125 14.1711 13.1039C14.3723 12.8268 14.5007 12.4595 14.5693 11.8264C14.6393 11.1803 14.6398 10.341 14.6398 9.14986V6.85014C14.6398 5.65896 14.6393 4.81967 14.5693 4.1736C14.5007 3.54048 14.3723 3.17318 14.1711 2.89609C14.0195 2.68747 13.8354 2.50337 13.6268 2.35179C13.3497 2.1506 12.9824 2.02212 12.3493 1.95353C11.7032 1.88358 10.8639 1.88307 9.67272 1.88307H6.3273C6.04709 1.88307 5.78636 1.8862 5.54303 1.88715ZM4.1828 1.91166C3.99125 1.9216 3.8148 1.93577 3.65076 1.95353C3.01764 2.02212 2.65034 2.1506 2.37325 2.35179C2.16463 2.50337 1.98052 2.68747 1.82895 2.89609C1.62776 3.17318 1.49928 3.54048 1.43069 4.1736C1.36074 4.81967 1.36023 5.65896 1.36023 6.85014V9.14986C1.36023 10.341 1.36074 11.1803 1.43069 11.8264C1.49928 12.4595 1.62776 12.7224 1.82895 13.1039C1.98052 13.3125 2.16463 13.4966 2.37325 13.6482C2.65034 13.8494 3.01764 13.9779 3.65076 14.0465C3.81478 14.0642 3.99127 14.0774 4.1828 14.0873V1.91166Z" fill="currentColor"></path>
        </svg>
      </button>
    </div>

    <div class="story-floating-sidebar-content" id="story-sidebar-navigation">
      <nav class="story-floating-nav">
        <RouterLink
          v-for="item in navigation"
          :key="item.href"
          class="story-floating-nav-item"
          :class="{ 'is-active': activePath === item.href }"
          :to="item.href"
          :aria-label="item.label"
          :aria-current="activePath === item.href ? 'page' : undefined"
        >
          <span class="story-floating-nav-label">{{ item.label }}</span>
          <span class="story-floating-nav-short" aria-hidden="true">{{ item.label.slice(0, 1) }}</span>
        </RouterLink>
      </nav>

      <div class="story-floating-recent-collapsed">
        <button
          class="story-floating-recent-collapsed-toggle"
          type="button"
          :aria-expanded="recentPopoverOpen"
          aria-label="最近对话"
          title="最近对话"
          @click.stop="toggleRecentPopover"
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M3.4 8.6A6.6 6.6 0 1 1 4.95 13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
            <path d="M3.4 4.2v4.4h4.4M10 6.8v3.6l2.4 1.4" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" />
          </svg>
        </button>
        <div v-if="recentPopoverOpen" class="story-floating-recent-popover" role="dialog" aria-label="最近对话">
          <div class="story-floating-recent-popover-header">
            <span class="story-floating-recent-popover-title">最近</span>
            <span class="story-floating-recent-popover-hint">对话历史</span>
          </div>
          <div class="story-floating-recent-popover-list">
            <span v-if="!recentConversations.length" class="story-floating-recent-empty">还没有聊过的对话</span>
            <RouterLink
              v-for="conversation in recentConversations"
              :key="conversation.id"
              class="story-floating-recent-item"
              :to="`/stories/${encodeURIComponent(conversation.projectId)}`"
              :title="conversation.title"
            >
              {{ conversation.title }}
            </RouterLink>
          </div>
        </div>
      </div>

      <section class="story-floating-recent" :class="{ 'is-collapsed': !recentExpanded }" aria-labelledby="story-recent-title">
        <h2 id="story-recent-title" class="story-floating-group-title">
          <button class="story-floating-group-toggle" type="button" :aria-expanded="recentExpanded" @click="toggleRecent">
            <span>最近</span>
            <span class="story-floating-group-chevron" aria-hidden="true">⌄</span>
          </button>
        </h2>
        <div v-show="recentExpanded" id="story-recent-list" class="story-floating-recent-list">
          <span v-if="!recentConversations.length" class="story-floating-recent-empty">还没有聊过的对话</span>
          <RouterLink
            v-for="conversation in recentConversations"
            :key="conversation.id"
            class="story-floating-recent-item"
            :to="`/stories/${encodeURIComponent(conversation.projectId)}`"
            :title="conversation.title"
          >
            {{ conversation.title }}
          </RouterLink>
        </div>
      </section>
    </div>

    <div class="story-floating-user" aria-label="当前用户">
      <span class="story-floating-user-avatar" aria-hidden="true">{{ userInitial }}</span>
      <span class="story-floating-user-copy">
        <small>当前用户</small>
        <strong>{{ userEmail }}</strong>
      </span>
    </div>
  </aside>
</template>
