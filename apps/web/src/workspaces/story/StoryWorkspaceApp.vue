<script setup lang="ts">
import { onMounted, provide, shallowReactive } from 'vue';
import {
  RouterView,
  routeLocationKey,
  routerKey,
  routerViewLocationKey,
} from 'vue-router';

import { createStoryRouter } from './router';

const props = defineProps<{
  initialPath?: string;
}>();

const router = createStoryRouter({ initialPath: props.initialPath });
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
  <RouterView />
</template>
