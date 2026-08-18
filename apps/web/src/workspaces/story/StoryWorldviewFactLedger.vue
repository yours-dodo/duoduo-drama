<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  getWorldviewAllowedSourceEntities,
  getWorldviewAllowedTargetEntities,
  getWorldviewEntities,
  getWorldviewFactsForEntity,
  getWorldviewPredicates,
  validateWorldviewFact,
  type WorldviewFactStatement,
  type WorldviewKnowledgeGraphState,
  type WorldviewValidationIssue,
} from './story-worldview-ontology';

const props = defineProps<{
  state: WorldviewKnowledgeGraphState;
  selectedEntityId: string | null;
  status: string;
}>();

const emit = defineEmits<{
  clearFilter: [];
  deleteFact: [factId: string];
  dirty: [];
  saveFact: [fact: WorldviewFactStatement];
}>();

let factSequence = 0;
const editingFactId = ref<string | null>(null);
const issues = ref<WorldviewValidationIssue[]>([]);

const predicates = computed(() => getWorldviewPredicates(props.state));
const activePredicates = computed(() =>
  predicates.value.filter((predicate) => predicate.status === 'active'),
);
const entityById = computed(
  () =>
    new Map(
      getWorldviewEntities(props.state).map((entity) => [entity.id, entity]),
    ),
);
const predicateById = computed(
  () => new Map(predicates.value.map((predicate) => [predicate.id, predicate])),
);
const visibleFacts = computed(() =>
  getWorldviewFactsForEntity(props.selectedEntityId, props.state),
);
const selectedEntity = computed(() =>
  props.selectedEntityId
    ? entityById.value.get(props.selectedEntityId)
    : undefined,
);

function nextFactId() {
  factSequence += 1;
  return `fact-local-${factSequence}`;
}

function createDraft(predicateId = activePredicates.value[0]?.id ?? '') {
  const sources = getWorldviewAllowedSourceEntities(predicateId, props.state);
  const targets = getWorldviewAllowedTargetEntities(predicateId, props.state);
  const selectedId = props.selectedEntityId;
  const selectedAsSource = sources.some((entity) => entity.id === selectedId);
  const selectedAsTarget = targets.some((entity) => entity.id === selectedId);
  const subjectId = selectedAsSource
    ? (selectedId ?? '')
    : (sources[0]?.id ?? '');
  const objectId = selectedAsTarget
    ? (selectedId ?? '')
    : (targets.find((entity) => entity.id !== subjectId)?.id ??
      targets[0]?.id ??
      '');

  return {
    id: nextFactId(),
    kind: 'fact' as const,
    subjectId,
    predicateId,
    objectId,
  };
}

const draft = ref<WorldviewFactStatement>(createDraft());
const allowedSources = computed(() =>
  getWorldviewAllowedSourceEntities(draft.value.predicateId, props.state),
);
const allowedTargets = computed(() =>
  getWorldviewAllowedTargetEntities(draft.value.predicateId, props.state),
);

watch(
  () => draft.value.predicateId,
  (predicateId, previousPredicateId) => {
    if (!predicateId || predicateId === previousPredicateId) return;
    const sourceIds = new Set(allowedSources.value.map((entity) => entity.id));
    const targetIds = new Set(allowedTargets.value.map((entity) => entity.id));
    if (!sourceIds.has(draft.value.subjectId)) {
      draft.value.subjectId = allowedSources.value[0]?.id ?? '';
    }
    if (
      !targetIds.has(draft.value.objectId) ||
      draft.value.objectId === draft.value.subjectId
    ) {
      draft.value.objectId =
        allowedTargets.value.find(
          (entity) => entity.id !== draft.value.subjectId,
        )?.id ??
        allowedTargets.value[0]?.id ??
        '';
    }
    issues.value = [];
  },
);

watch(
  () => props.selectedEntityId,
  () => {
    if (!editingFactId.value) resetDraft();
  },
);

function resetDraft() {
  editingFactId.value = null;
  issues.value = [];
  draft.value = createDraft(draft.value.predicateId);
}

function markDirty() {
  issues.value = [];
  emit('dirty');
}

function saveFact() {
  issues.value = validateWorldviewFact(draft.value, props.state);
  if (issues.value.length) return;
  emit('saveFact', { ...draft.value });
  resetDraft();
}

function editFact(fact: WorldviewFactStatement) {
  editingFactId.value = fact.id;
  issues.value = [];
  draft.value = { ...fact };
}

function removeFact(factId: string) {
  emit('deleteFact', factId);
  if (editingFactId.value === factId) resetDraft();
}

function entityName(entityId: string) {
  return entityById.value.get(entityId)?.name ?? '未知实体';
}

function predicateLabel(predicateId: string) {
  return predicateById.value.get(predicateId)?.label ?? '未知关系';
}
</script>

<template>
  <section
    class="worldview-fact-ledger"
    aria-labelledby="worldview-fact-ledger-title"
  >
    <header class="worldview-fact-ledger-heading">
      <div>
        <span>FACT LEDGER / EDIT SOURCE</span>
        <h4 id="worldview-fact-ledger-title">事实关系清单</h4>
        <p v-if="selectedEntity">
          当前筛选：{{ selectedEntity.name }} 的传入与传出关系。
        </p>
        <p v-else>当前项目的全部正式事实关系。</p>
      </div>
      <div class="worldview-fact-ledger-meta">
        <strong>{{ visibleFacts.length }} 条事实</strong>
        <span>{{ status }}</span>
      </div>
    </header>

    <form
      class="worldview-fact-compose"
      aria-label="新增或编辑事实关系"
      @submit.prevent="saveFact"
      @change="markDirty"
    >
      <label>
        <span>关系类型</span>
        <select v-model="draft.predicateId">
          <option
            v-for="predicate in predicates"
            :key="predicate.id"
            :value="predicate.id"
            :disabled="predicate.status === 'inactive'"
          >
            {{ predicate.label
            }}{{ predicate.status === 'inactive' ? ' · 已停用' : '' }}
          </option>
        </select>
      </label>

      <label>
        <span>源实体</span>
        <select v-model="draft.subjectId">
          <option
            v-for="entity in allowedSources"
            :key="entity.id"
            :value="entity.id"
          >
            {{ entity.type }} · {{ entity.name }}
          </option>
        </select>
      </label>

      <span class="worldview-fact-compose-arrow" aria-hidden="true">→</span>

      <label>
        <span>目标实体</span>
        <select v-model="draft.objectId">
          <option
            v-for="entity in allowedTargets"
            :key="entity.id"
            :value="entity.id"
          >
            {{ entity.type }} · {{ entity.name }}
          </option>
        </select>
      </label>

      <div class="worldview-fact-compose-actions">
        <button
          v-if="editingFactId"
          class="is-quiet"
          type="button"
          @click="resetDraft"
        >
          取消
        </button>
        <button type="submit">
          {{ editingFactId ? '更新事实' : '新增事实' }}
        </button>
      </div>

      <div v-if="issues.length" class="worldview-fact-alert" role="alert">
        {{ issues[0]?.message }}
      </div>
    </form>

    <div class="worldview-fact-table" role="table" aria-label="事实关系">
      <div class="worldview-fact-table-header" role="row">
        <span role="columnheader">源实体</span>
        <span role="columnheader">关系</span>
        <span role="columnheader">目标实体</span>
        <span role="columnheader">操作</span>
      </div>

      <article
        v-for="fact in visibleFacts"
        :key="fact.id"
        class="worldview-fact-row"
        :class="{ 'is-editing': editingFactId === fact.id }"
        role="row"
      >
        <span role="cell" data-label="源实体">
          {{ entityName(fact.subjectId) }}
        </span>
        <strong role="cell" data-label="关系">
          {{ predicateLabel(fact.predicateId) }}
        </strong>
        <span role="cell" data-label="目标实体">
          {{ entityName(fact.objectId) }}
        </span>
        <div class="worldview-fact-row-actions" role="cell">
          <button type="button" @click="editFact(fact)">编辑</button>
          <button type="button" @click="removeFact(fact.id)">删除</button>
        </div>
      </article>

      <div v-if="!visibleFacts.length" class="worldview-fact-empty">
        <strong>当前范围没有事实关系</strong>
        <p>可以使用上方编辑行创建第一条正式事实。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.worldview-fact-ledger {
  min-width: 0;
  padding-bottom: 28px;
}

.worldview-fact-ledger-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 0 14px;
}

.worldview-fact-ledger-heading > div > span,
.worldview-fact-ledger-meta strong {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.56rem;
  font-weight: 400;
  letter-spacing: 0.1em;
}

.worldview-fact-ledger-heading h4 {
  margin: 6px 0 4px;
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 1.3rem;
  font-weight: 400;
}

.worldview-fact-ledger-heading p {
  margin: 0;
  color: var(--story-entry-muted);
  font-size: 0.66rem;
  line-height: 1.6;
}

.worldview-fact-ledger-meta {
  display: grid;
  flex: 0 0 auto;
  gap: 7px;
  justify-items: end;
  color: var(--story-entry-muted);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.54rem;
}

.worldview-fact-compose {
  display: grid;
  grid-template-columns:
    minmax(126px, 0.8fr) minmax(150px, 1fr) 20px minmax(150px, 1fr)
    auto;
  gap: 10px;
  align-items: end;
  padding: 14px;
  border: 1px solid var(--story-worldview-border-strong);
  background: color-mix(
    in srgb,
    var(--story-entry-blue) 4%,
    var(--story-entry-paper)
  );
}

.worldview-fact-compose label {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.worldview-fact-compose label > span {
  color: var(--story-entry-muted);
  font-size: 0.58rem;
}

.worldview-fact-compose select {
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid var(--story-worldview-border-strong);
  color: var(--story-entry-ink);
  background: var(--story-entry-paper);
  font: inherit;
  font-size: 0.68rem;
}

.worldview-fact-compose-arrow {
  display: grid;
  min-height: 36px;
  place-items: center;
  color: var(--story-entry-blue);
}

.worldview-fact-compose-actions {
  display: flex;
  gap: 7px;
}

.worldview-fact-compose-actions button,
.worldview-fact-row-actions button {
  min-height: 34px;
  padding: 5px 10px;
  border: 1px solid var(--story-entry-blue);
  color: var(--story-entry-paper);
  background: var(--story-entry-blue);
  cursor: pointer;
  font: inherit;
  font-size: 0.62rem;
  white-space: nowrap;
}

.worldview-fact-compose-actions button.is-quiet,
.worldview-fact-row-actions button {
  color: var(--story-entry-muted);
  background: transparent;
}

.worldview-fact-alert {
  grid-column: 1 / -1;
  padding-top: 3px;
  color: var(--story-entry-blue);
  font-size: 0.62rem;
}

.worldview-fact-table {
  margin-top: 12px;
  border-top: 1px solid var(--story-worldview-border-strong);
}

.worldview-fact-table-header,
.worldview-fact-row {
  display: grid;
  grid-template-columns:
    minmax(130px, 1fr) minmax(100px, 0.7fr) minmax(150px, 1fr)
    112px;
  gap: 12px;
  align-items: center;
  min-width: 0;
  padding: 10px 12px;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-fact-table-header {
  color: var(--story-entry-muted);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.54rem;
  letter-spacing: 0.06em;
}

.worldview-fact-row {
  color: var(--story-entry-ink);
  font-size: 0.7rem;
}

.worldview-fact-row.is-editing {
  background: color-mix(in srgb, var(--story-entry-blue) 8%, transparent);
}

.worldview-fact-row strong {
  color: var(--story-entry-blue);
  font-weight: 500;
}

.worldview-fact-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.worldview-fact-row-actions button {
  min-height: 28px;
  padding: 3px 8px;
}

.worldview-fact-empty {
  display: grid;
  min-height: 130px;
  place-content: center;
  text-align: center;
}

.worldview-fact-empty strong {
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-fact-empty p {
  margin: 7px 0 0;
  color: var(--story-entry-muted);
  font-size: 0.64rem;
}

@media (max-width: 880px) {
  .worldview-fact-compose {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .worldview-fact-compose-arrow {
    display: none;
  }

  .worldview-fact-compose-actions {
    align-self: end;
    justify-content: flex-end;
  }
}

@media (max-width: 700px) {
  .worldview-fact-ledger-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .worldview-fact-ledger-meta {
    justify-items: start;
  }

  .worldview-fact-compose {
    grid-template-columns: 1fr;
  }

  .worldview-fact-compose-actions {
    justify-content: stretch;
  }

  .worldview-fact-compose-actions button {
    flex: 1 1 auto;
  }

  .worldview-fact-table-header {
    display: none;
  }

  .worldview-fact-row {
    grid-template-columns: 1fr;
    gap: 7px;
    padding: 13px 0;
  }

  .worldview-fact-row > span::before,
  .worldview-fact-row > strong::before {
    display: inline-block;
    width: 60px;
    margin-right: 8px;
    color: var(--story-entry-muted);
    content: attr(data-label);
    font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
    font-size: 0.52rem;
    font-weight: 400;
  }

  .worldview-fact-row-actions {
    justify-content: flex-start;
    padding-left: 68px;
  }
}
</style>
