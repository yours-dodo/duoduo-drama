<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import StoryWorldviewEntityEditor from './StoryWorldviewEntityEditor.vue';
import {
  getWorldviewEntities,
  worldviewRoleAssetOptions,
  type WorldviewEntity,
} from './story-worldview-ontology';
import { useStoryWorldviewStateRegistry } from './story-worldview-state';

const route = useRoute();
const router = useRouter();
const worldviewStateRegistry = useStoryWorldviewStateRegistry();
const projectId = computed(() => String(route.params.projectId ?? ''));
const entityId = computed(() => String(route.params.entityId ?? ''));
const compositionPath = computed(
  () => `/${encodeURIComponent(projectId.value)}/worldview/composition`,
);
const graph = computed(() => worldviewStateRegistry.getGraph(projectId.value));
const entities = computed(() => getWorldviewEntities(graph.value));
const entity = computed(() =>
  worldviewStateRegistry.getEntity(projectId.value, entityId.value),
);
const status = ref('编辑后保存将返回世界构成');

watch(entityId, () => {
  status.value = '编辑后保存将返回世界构成';
});

function markDirty() {
  status.value = '正在编辑 · 尚未保存';
}

async function saveEntity(nextEntity: WorldviewEntity) {
  if (!worldviewStateRegistry.saveEntity(projectId.value, nextEntity)) {
    status.value = '保存失败：实体已经不存在';
    return;
  }
  await router.replace(compositionPath.value);
}

async function deleteEntity() {
  const result = worldviewStateRegistry.deleteEntity(
    projectId.value,
    entityId.value,
  );
  if (!result.deleted) {
    status.value = result.references.length
      ? `无法删除：请先处理${result.references.join('、')}`
      : '删除失败：实体已经不存在';
    return;
  }
  await router.replace(compositionPath.value);
}
</script>

<template>
  <section
    class="story-project-route story-worldview-entity-edit-route"
    aria-labelledby="story-worldview-entity-edit-title"
  >
    <div class="story-project-content-toolbar">
      <RouterLink class="story-project-back-link" :to="compositionPath">
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
        <span>返回世界构成</span>
      </RouterLink>

      <span class="story-project-module-kicker">基础资产 / WORLDVIEW</span>

      <div
        v-if="entity"
        class="story-project-toolbar-actions"
        aria-label="实体操作"
      >
        <button
          class="story-project-toolbar-action is-danger"
          type="button"
          @click="deleteEntity"
        >
          删除实体
        </button>
      </div>
    </div>

    <main class="story-worldview-entity-edit-main">
      <div v-if="entity" class="story-worldview-entity-edit-shell">
        <header class="story-worldview-entity-edit-header">
          <div>
            <span>{{ entity.type }} / ENTITY ATTRIBUTES</span>
            <h1 id="story-worldview-entity-edit-title">{{ entity.name }}</h1>
          </div>
        </header>

        <StoryWorldviewEntityEditor
          :key="entity.id"
          :entity="entity"
          :entities="entities"
          :role-assets="worldviewRoleAssetOptions"
          :status="status"
          @dirty="markDirty"
          @save="saveEntity"
        />
      </div>

      <section v-else class="story-worldview-entity-edit-not-found">
        <span>实体 / {{ entityId || '未知' }}</span>
        <h1 id="story-worldview-entity-edit-title">没有找到这个世界实体</h1>
        <p>这个实体不存在，可能已被移除，或当前链接不属于这个项目。</p>
        <RouterLink :to="compositionPath">返回世界构成</RouterLink>
      </section>
    </main>
  </section>
</template>

<style scoped>
.story-worldview-entity-edit-main {
  padding: 0 44px 64px;
  color: var(--story-entry-ink);
}

.story-worldview-entity-edit-shell {
  max-width: 980px;
  margin: 0 auto;
  border-top: 1px solid var(--story-entry-line);
}

.story-worldview-entity-edit-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 0 24px;
  border-bottom: 1px solid var(--story-entry-line);
}

.story-worldview-entity-edit-header span,
.story-worldview-entity-edit-not-found > span {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.story-worldview-entity-edit-header h1,
.story-worldview-entity-edit-not-found h1 {
  margin: 8px 0 0;
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: clamp(1.7rem, 3vw, 2.5rem);
  font-weight: 400;
  letter-spacing: -0.04em;
}

.story-worldview-entity-edit-not-found {
  max-width: 720px;
  margin: 0 auto;
  padding: 56px 0;
  border-top: 1px solid var(--story-entry-line);
}

.story-worldview-entity-edit-not-found p {
  margin: 16px 0 24px;
  color: var(--story-entry-muted);
  font-size: 0.84rem;
  line-height: 1.7;
}

.story-worldview-entity-edit-not-found a {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  padding: 0 16px;
  border: 1px solid var(--story-entry-blue);
  color: var(--story-entry-paper);
  background: var(--story-entry-blue);
  font-size: 0.74rem;
  text-decoration: none;
}

@media (max-width: 700px) {
  .story-worldview-entity-edit-main {
    padding: 0 20px 48px;
  }

  .story-worldview-entity-edit-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
