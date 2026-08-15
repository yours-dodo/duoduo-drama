<script setup lang="ts">
import { computed, onMounted, provide, shallowReactive } from 'vue';
import {
  RouterView,
  routeLocationKey,
  routerKey,
  routerViewLocationKey,
} from 'vue-router';

import { createStoryRouter } from './router';
import StoryChatPanel from './StoryChatPanel.vue';
import StorySidebar from './StorySidebar.vue';
import StoryWorkspaceHeader from './StoryWorkspaceHeader.vue';

const props = defineProps<{
  initialPath?: string;
}>();

const router = createStoryRouter({ initialPath: props.initialPath });
const isProjectRoute = computed(() => router.currentRoute.value.meta.page === 'project');
const reactiveRoute = shallowReactive<Record<string, unknown>>({});

for (const key of Object.keys(router.currentRoute.value)) {
  Object.defineProperty(reactiveRoute, key, {
    enumerable: true,
    get: () => router.currentRoute.value[key as keyof typeof router.currentRoute.value],
  });
}

provide(routerKey, router);
provide(routeLocationKey, reactiveRoute as never);
provide(routerViewLocationKey, router.currentRoute);

onMounted(() => {
  void router.isReady();
});
</script>

<template>
  <div class="story-workspace-app">
    <StoryWorkspaceHeader />
    <StorySidebar v-if="!isProjectRoute" />
    <main class="story-workspace-app-content">
      <RouterView />
    </main>
    <StoryChatPanel v-if="isProjectRoute" />
  </div>
</template>
