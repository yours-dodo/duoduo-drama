<script setup lang="ts">
import { computed, provide, shallowReactive, shallowRef, watch } from 'vue';
import {
  RouterView,
  routeLocationKey,
  routerKey,
  routerViewLocationKey,
} from 'vue-router';

import { createStoryRouter, toStoryRoutePath } from './router';
import StoryChatPanel from './StoryChatPanel.vue';
import StorySidebar from './StorySidebar.vue';
import StoryWorkspaceHeader from './StoryWorkspaceHeader.vue';

const props = defineProps<{
  initialPath?: string;
}>();

const router = createStoryRouter();
if (props.initialPath) {
  await router.replace(toStoryRoutePath(props.initialPath));
}
await router.isReady();
const initialRoute = router.currentRoute.value;
const routeState = shallowRef(initialRoute);
const isProjectRoute = computed(() => routeState.value.meta.page === 'project');
const reactiveRoute = shallowReactive<Record<string, unknown>>({});

for (const key of Object.keys(initialRoute)) {
  Object.defineProperty(reactiveRoute, key, {
    enumerable: true,
    get: () => routeState.value[key as keyof typeof routeState.value],
  });
}

provide(routerKey, router);
provide(routeLocationKey, reactiveRoute as never);
provide(routerViewLocationKey, routeState);

watch(router.currentRoute, (nextRoute) => {
  routeState.value = nextRoute;
});
</script>

<template>
  <div class="story-workspace-app">
    <StoryWorkspaceHeader />
    <StorySidebar v-if="!isProjectRoute" />
    <main class="story-workspace-app-content" :class="{ 'is-project': isProjectRoute }">
      <div class="story-workspace-app-route">
        <RouterView />
      </div>
      <StoryChatPanel v-if="isProjectRoute" />
    </main>
  </div>
</template>
