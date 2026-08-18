<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import {
  getWorldviewPredicateDefinitions,
  validateWorldviewPredicateDefinition,
  type WorldviewEntityType,
  type WorldviewKnowledgeGraphState,
  type WorldviewPredicateDefinition,
  type WorldviewValidationIssue,
} from './story-worldview-ontology';

const props = defineProps<{
  state: WorldviewKnowledgeGraphState;
  status: string;
}>();

const emit = defineEmits<{
  close: [];
  dirty: [];
  saveDefinition: [definition: WorldviewPredicateDefinition];
  togglePredicate: [predicateId: string];
}>();

const entityTypes: WorldviewEntityType[] = ['地点', '组织', '角色', '规则'];
const definitions = computed(() =>
  getWorldviewPredicateDefinitions(props.state),
);
const editingPredicateId = ref<string | null>(null);
const issues = ref<WorldviewValidationIssue[]>([]);
let predicateSequence = 0;

const draft = reactive({
  label: '',
  sourceType: '角色' as WorldviewEntityType,
  targetType: '组织' as WorldviewEntityType,
  inversePredicateId: '',
});

function resetDraft() {
  editingPredicateId.value = null;
  issues.value = [];
  draft.label = '';
  draft.sourceType = '角色';
  draft.targetType = '组织';
  draft.inversePredicateId = '';
}

function editDefinition(definition: WorldviewPredicateDefinition) {
  if (definition.predicate.scope !== 'project') return;
  editingPredicateId.value = definition.predicate.id;
  issues.value = [];
  draft.label = definition.predicate.label;
  draft.sourceType = definition.sourceTypes[0] ?? '角色';
  draft.targetType = definition.targetTypes[0] ?? '组织';
  draft.inversePredicateId = definition.inversePredicateId ?? '';
}

function saveDefinition() {
  if (!editingPredicateId.value) predicateSequence += 1;
  const existing = definitions.value.find(
    (definition) => definition.predicate.id === editingPredicateId.value,
  );
  const definition: WorldviewPredicateDefinition = {
    predicate: {
      id:
        editingPredicateId.value ??
        `project-predicate-${Date.now()}-${predicateSequence}`,
      kind: 'predicate',
      usage: 'fact',
      label: draft.label.trim(),
      scope: 'project',
      status: existing?.predicate.status ?? 'active',
    },
    sourceTypes: [draft.sourceType],
    targetTypes: [draft.targetType],
    inversePredicateId: draft.inversePredicateId || null,
  };

  issues.value = validateWorldviewPredicateDefinition(definition, props.state);
  if (issues.value.length) return;
  emit('saveDefinition', definition);
  resetDraft();
}

function markDirty() {
  issues.value = [];
  emit('dirty');
}
</script>

<template>
  <div class="worldview-ontology-manager-layer">
    <button
      class="worldview-ontology-manager-backdrop"
      type="button"
      aria-label="关闭 Ontology 管理"
      @click="emit('close')"
    ></button>
    <section
      class="worldview-ontology-manager"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worldview-ontology-manager-title"
    >
      <header class="worldview-ontology-manager-header">
        <div>
          <span>ONTOLOGY / PREDICATE SCHEMA</span>
          <h3 id="worldview-ontology-manager-title">关系类型管理</h3>
          <p>这里定义事实关系允许连接的实体类型；默认事实图不会展示 schema。</p>
        </div>
        <div class="worldview-ontology-manager-actions">
          <strong>{{ status }}</strong>
          <button type="button" @click="emit('close')">关闭</button>
        </div>
      </header>

      <div class="worldview-ontology-manager-content">
        <section
          class="worldview-ontology-list"
          aria-labelledby="worldview-ontology-list-title"
        >
          <div class="worldview-ontology-section-title">
            <span>01</span>
            <div>
              <h4 id="worldview-ontology-list-title">当前 Ontology</h4>
              <p>系统核心只读，项目关系可以编辑和停用。</p>
            </div>
          </div>

          <article
            v-for="definition in definitions"
            :key="definition.predicate.id"
            class="worldview-ontology-row"
            :class="{
              'is-inactive': definition.predicate.status === 'inactive',
            }"
          >
            <div class="worldview-ontology-row-name">
              <strong>{{ definition.predicate.label }}</strong>
              <span>
                {{
                  definition.predicate.scope === 'system'
                    ? '系统核心'
                    : '项目扩展'
                }}
                ·
                {{ definition.predicate.status === 'active' ? '启用' : '停用' }}
              </span>
            </div>
            <div class="worldview-ontology-row-schema">
              <span>{{ definition.sourceTypes.join('/') || '任意' }}</span>
              <b>→</b>
              <span>{{ definition.targetTypes.join('/') || '任意' }}</span>
              <small v-if="definition.inversePredicateId">
                反向：{{
                  definitions.find(
                    (candidate) =>
                      candidate.predicate.id === definition.inversePredicateId,
                  )?.predicate.label ?? '未知关系'
                }}
              </small>
            </div>
            <div class="worldview-ontology-row-actions">
              <span v-if="definition.predicate.scope === 'system'">只读</span>
              <template v-else>
                <button type="button" @click="editDefinition(definition)">
                  编辑
                </button>
                <button
                  type="button"
                  @click="emit('togglePredicate', definition.predicate.id)"
                >
                  {{
                    definition.predicate.status === 'active' ? '停用' : '启用'
                  }}
                </button>
              </template>
            </div>
          </article>
        </section>

        <section
          class="worldview-ontology-compose"
          aria-labelledby="worldview-ontology-compose-title"
        >
          <div class="worldview-ontology-section-title">
            <span>02</span>
            <div>
              <h4 id="worldview-ontology-compose-title">
                {{ editingPredicateId ? '编辑项目关系' : '新增项目关系' }}
              </h4>
              <p>关系定义保存为 schema statement，不会直接生成世界事实。</p>
            </div>
          </div>

          <form
            @submit.prevent="saveDefinition"
            @change="markDirty"
            @input="markDirty"
          >
            <label>
              <span>关系名称</span>
              <input
                v-model="draft.label"
                type="text"
                placeholder="例如：保护"
              />
            </label>
            <label>
              <span>源类型</span>
              <select v-model="draft.sourceType">
                <option v-for="type in entityTypes" :key="type" :value="type">
                  {{ type }}
                </option>
              </select>
            </label>
            <label>
              <span>目标类型</span>
              <select v-model="draft.targetType">
                <option v-for="type in entityTypes" :key="type" :value="type">
                  {{ type }}
                </option>
              </select>
            </label>
            <label>
              <span>反向关系 <i>可选</i></span>
              <select v-model="draft.inversePredicateId">
                <option value="">未指定</option>
                <option
                  v-for="definition in definitions"
                  :key="definition.predicate.id"
                  :value="definition.predicate.id"
                >
                  {{ definition.predicate.label }}
                </option>
              </select>
            </label>
            <div class="worldview-ontology-compose-actions">
              <button
                v-if="editingPredicateId"
                class="is-quiet"
                type="button"
                @click="resetDraft"
              >
                取消
              </button>
              <button type="submit">
                {{ editingPredicateId ? '更新关系定义' : '登记关系定义' }}
              </button>
            </div>
            <small v-if="issues.length" role="alert">
              {{ issues[0]?.message }}
            </small>
          </form>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.worldview-ontology-manager-layer {
  position: fixed;
  z-index: 250;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 36px;
}

.worldview-ontology-manager-backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  border: 0;
  background: rgba(0, 0, 0, 0.72);
}

.worldview-ontology-manager {
  position: relative;
  display: flex;
  width: min(980px, 100%);
  max-height: min(820px, calc(100dvh - 72px));
  flex-direction: column;
  border: 2px solid var(--story-worldview-border-strong);
  color: var(--story-entry-ink);
  background: var(--story-entry-paper);
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.5);
}

.worldview-ontology-manager-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 22px;
  border-bottom: 2px solid var(--story-worldview-border-strong);
}

.worldview-ontology-manager-header span,
.worldview-ontology-manager-actions strong,
.worldview-ontology-section-title > span {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.56rem;
  font-weight: 400;
  letter-spacing: 0.1em;
}

.worldview-ontology-manager-header h3,
.worldview-ontology-section-title h4 {
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-ontology-manager-header h3 {
  margin: 7px 0 5px;
  font-size: 1.5rem;
}

.worldview-ontology-manager-header p,
.worldview-ontology-section-title p {
  margin: 0;
  color: var(--story-entry-muted);
  font-size: 0.66rem;
  line-height: 1.6;
}

.worldview-ontology-manager-actions {
  display: grid;
  flex: 0 0 auto;
  gap: 9px;
  justify-items: end;
}

.worldview-ontology-manager-actions button,
.worldview-ontology-row-actions button,
.worldview-ontology-compose-actions button {
  min-height: 30px;
  padding: 4px 9px;
  border: 1px solid var(--story-worldview-border-strong);
  color: var(--story-entry-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.6rem;
}

.worldview-ontology-manager-content {
  min-height: 0;
  overflow-y: auto;
  padding: 0 22px 26px;
}

.worldview-ontology-list,
.worldview-ontology-compose {
  display: grid;
  grid-template-columns: minmax(160px, 210px) minmax(0, 1fr);
  gap: 24px;
  padding: 22px 0;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-ontology-section-title {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-content: start;
}

.worldview-ontology-section-title h4 {
  margin: 0 0 5px;
  font-size: 1rem;
}

.worldview-ontology-row {
  grid-column: 2;
  display: grid;
  grid-template-columns: minmax(130px, 0.9fr) minmax(180px, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 11px 0;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-ontology-row.is-inactive {
  opacity: 0.5;
}

.worldview-ontology-row-name,
.worldview-ontology-row-schema {
  display: grid;
  gap: 5px;
}

.worldview-ontology-row-name strong {
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-ontology-row-name span,
.worldview-ontology-row-schema small,
.worldview-ontology-row-actions > span {
  color: var(--story-entry-muted);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.52rem;
}

.worldview-ontology-row-schema {
  grid-template-columns: auto 20px auto;
  align-items: center;
  font-size: 0.68rem;
}

.worldview-ontology-row-schema b {
  color: var(--story-entry-blue);
  font-weight: 400;
}

.worldview-ontology-row-schema small {
  grid-column: 1 / -1;
}

.worldview-ontology-row-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.worldview-ontology-compose form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.worldview-ontology-compose label {
  display: grid;
  gap: 6px;
  color: var(--story-entry-muted);
  font-size: 0.58rem;
}

.worldview-ontology-compose label i {
  font-style: normal;
}

.worldview-ontology-compose input,
.worldview-ontology-compose select {
  width: 100%;
  min-height: 38px;
  padding: 7px 9px;
  border: 1px solid var(--story-worldview-border-strong);
  color: var(--story-entry-ink);
  background: var(--story-entry-paper);
  font: inherit;
  font-size: 0.68rem;
}

.worldview-ontology-compose-actions {
  display: flex;
  grid-column: 1 / -1;
  gap: 8px;
  justify-content: flex-end;
}

.worldview-ontology-compose-actions button:last-child {
  border-color: var(--story-entry-blue);
  color: var(--story-entry-paper);
  background: var(--story-entry-blue);
}

.worldview-ontology-compose form > small {
  grid-column: 1 / -1;
  color: var(--story-entry-blue);
}

@media (max-width: 700px) {
  .worldview-ontology-manager-layer {
    padding: 0;
  }

  .worldview-ontology-manager {
    width: 100%;
    height: 100dvh;
    max-height: none;
    border: 0;
  }

  .worldview-ontology-manager-header,
  .worldview-ontology-list,
  .worldview-ontology-compose {
    grid-template-columns: 1fr;
  }

  .worldview-ontology-manager-header {
    flex-direction: column;
  }

  .worldview-ontology-manager-actions {
    justify-items: start;
  }

  .worldview-ontology-row {
    grid-column: 1;
    grid-template-columns: 1fr;
  }

  .worldview-ontology-row-actions {
    justify-content: flex-start;
  }

  .worldview-ontology-compose form {
    grid-template-columns: 1fr;
  }
}
</style>
