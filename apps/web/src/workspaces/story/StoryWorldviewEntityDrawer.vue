<script setup lang="ts">
import StoryWorldviewEntityEditor from './StoryWorldviewEntityEditor.vue';
import type {
  WorldviewEntity,
  WorldviewRoleAssetOption,
} from './story-worldview-ontology';

defineProps<{
  entity: WorldviewEntity;
  entities: readonly WorldviewEntity[];
  roleAssets: readonly WorldviewRoleAssetOption[];
  status: string;
}>();

const emit = defineEmits<{
  close: [];
  delete: [];
  dirty: [];
  save: [entity: WorldviewEntity];
}>();
</script>

<template>
  <div class="worldview-entity-drawer-layer">
    <button
      class="worldview-entity-drawer-backdrop"
      type="button"
      aria-label="关闭实体属性编辑器"
      @click="emit('close')"
    ></button>
    <aside
      class="worldview-entity-drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="`编辑${entity.type}${entity.name}`"
    >
      <header class="worldview-entity-drawer-header">
        <div>
          <span>ENTITY ATTRIBUTES</span>
          <strong>{{ entity.name }}</strong>
        </div>
        <div>
          <button class="is-delete" type="button" @click="emit('delete')">
            删除实体
          </button>
          <button type="button" @click="emit('close')">关闭</button>
        </div>
      </header>

      <div class="worldview-entity-drawer-content">
        <StoryWorldviewEntityEditor
          :key="entity.id"
          :entity="entity"
          :entities="entities"
          :role-assets="roleAssets"
          :status="status"
          @dirty="emit('dirty')"
          @save="emit('save', $event)"
        />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.worldview-entity-drawer-layer {
  position: fixed;
  z-index: 240;
  inset: 0;
}

.worldview-entity-drawer-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgba(0, 0, 0, 0.66);
  cursor: default;
}

.worldview-entity-drawer {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  width: min(760px, calc(100% - 48px));
  height: 100%;
  flex-direction: column;
  border-left: 2px solid var(--story-worldview-border-strong);
  color: var(--story-entry-ink);
  background: var(--story-entry-paper);
  box-shadow: -24px 0 80px rgba(0, 0, 0, 0.36);
}

.worldview-entity-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 15px 20px;
  border-bottom: 2px solid var(--story-worldview-border-strong);
}

.worldview-entity-drawer-header > div {
  display: flex;
  align-items: center;
  gap: 10px;
}

.worldview-entity-drawer-header span {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.54rem;
  letter-spacing: 0.1em;
}

.worldview-entity-drawer-header strong {
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-entity-drawer-header button {
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--story-worldview-border-strong);
  color: var(--story-entry-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.6rem;
}

.worldview-entity-drawer-header button:hover,
.worldview-entity-drawer-header button:focus-visible,
.worldview-entity-drawer-header button.is-delete {
  border-color: var(--story-entry-blue);
  color: var(--story-entry-blue);
}

.worldview-entity-drawer-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 22px;
}

@media (max-width: 700px) {
  .worldview-entity-drawer {
    width: 100%;
    border-left: 0;
  }

  .worldview-entity-drawer-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .worldview-entity-drawer-content {
    padding-inline: 16px;
  }
}
</style>
