<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import {
  cloneWorldviewEntity,
  validateWorldviewEntity,
  type WorldviewEntity,
  type WorldviewRoleAssetOption,
  type WorldviewValidationIssue,
} from './story-worldview-ontology';

const props = defineProps<{
  entity: WorldviewEntity;
  entities: readonly WorldviewEntity[];
  roleAssets: readonly WorldviewRoleAssetOption[];
  status: string;
}>();

const emit = defineEmits<{
  dirty: [];
  save: [entity: WorldviewEntity];
}>();

const draft = ref<WorldviewEntity>(cloneWorldviewEntity(props.entity));
const issues = ref<WorldviewValidationIssue[]>([]);
const descriptionEditor = ref<HTMLElement | null>(null);

const aliasesText = computed({
  get: () => draft.value.aliases.join('、'),
  set: (value: string) => {
    draft.value.aliases = value
      .split(/[、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  },
});

const exceptionsText = computed({
  get: () =>
    draft.value.type === '规则'
      ? draft.value.attributes.exceptions.join('\n')
      : '',
  set: (value: string) => {
    if (draft.value.type !== '规则') return;
    draft.value.attributes.exceptions = value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  },
});

const locationOptions = computed(() =>
  props.entities.filter(
    (entity) => entity.type === '地点' && entity.id !== draft.value.id,
  ),
);

watch(
  () => props.entity,
  (entity) => {
    draft.value = cloneWorldviewEntity(entity);
    issues.value = [];
  },
  { deep: true },
);

function markDirty() {
  issues.value = [];
  emit('dirty');
}

function fieldIssue(field: string) {
  return issues.value.find((issue) => issue.field === field)?.message;
}

function handleDescriptionInput(event: Event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  draft.value.description = target.innerHTML;
  markDirty();
}

function formatDescription(command: string, value?: string) {
  descriptionEditor.value?.focus();
  document.execCommand(command, false, value);
  if (descriptionEditor.value) {
    draft.value.description = descriptionEditor.value.innerHTML;
  }
  markDirty();
}

function saveEntity() {
  issues.value = validateWorldviewEntity(
    draft.value,
    props.entities,
    props.roleAssets,
  );
  if (issues.value.length) return;
  emit('save', cloneWorldviewEntity(draft.value));
}
</script>

<template>
  <form
    class="worldview-entity-editor"
    aria-label="世界要素详情编辑器"
    @submit.prevent="saveEntity"
    @input="markDirty"
    @change="markDirty"
  >
    <header class="worldview-editor-heading">
      <div>
        <span class="worldview-editor-kicker"
          >{{ draft.type }} / STRUCTURED SOURCE</span
        >
        <h4>结构化详情</h4>
        <p>字段用于 AI 与检索，补充说明承载叙事语境。</p>
      </div>
      <div class="worldview-editor-save">
        <span>{{ status }}</span>
        <button type="submit">保存详情</button>
      </div>
    </header>

    <div v-if="issues.length" class="worldview-editor-alert" role="alert">
      <strong>还有 {{ issues.length }} 项需要完善</strong>
      <span>{{ issues[0]?.message }}</span>
    </div>

    <section
      class="worldview-editor-section"
      aria-labelledby="worldview-common-fields"
    >
      <div class="worldview-editor-section-title">
        <span>01</span>
        <div>
          <h5 id="worldview-common-fields">通用字段</h5>
          <p>所有要素共享的检索入口与语义摘要。</p>
        </div>
      </div>

      <div class="worldview-form-grid">
        <label class="worldview-field">
          <span>名称 <b>必填</b></span>
          <input v-model="draft.name" type="text" autocomplete="off" />
          <small v-if="fieldIssue('name')">{{ fieldIssue('name') }}</small>
        </label>

        <label class="worldview-field">
          <span>别名 <i>使用顿号分隔</i></span>
          <input v-model="aliasesText" type="text" autocomplete="off" />
        </label>

        <label class="worldview-field is-wide">
          <span>一句话摘要 <b>必填</b></span>
          <textarea v-model="draft.summary" rows="2"></textarea>
          <small v-if="fieldIssue('summary')">{{
            fieldIssue('summary')
          }}</small>
        </label>
      </div>
    </section>

    <section
      class="worldview-editor-section"
      aria-labelledby="worldview-type-fields"
    >
      <div class="worldview-editor-section-title">
        <span>02</span>
        <div>
          <h5 id="worldview-type-fields">{{ draft.type }}属性</h5>
          <p>由目录类型决定，不在表单中切换类型。</p>
        </div>
      </div>

      <div v-if="draft.type === '地点'" class="worldview-form-grid">
        <label class="worldview-field">
          <span>地点类型 <b>必填</b></span>
          <input v-model="draft.attributes.locationType" type="text" />
          <small v-if="fieldIssue('attributes.locationType')">
            {{ fieldIssue('attributes.locationType') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>上级地点</span>
          <select v-model="draft.attributes.parentLocationId">
            <option :value="null">无上级地点</option>
            <option
              v-for="location in locationOptions"
              :key="location.id"
              :value="location.id"
            >
              {{ location.name }}
            </option>
          </select>
          <small v-if="fieldIssue('attributes.parentLocationId')">
            {{ fieldIssue('attributes.parentLocationId') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>时代 <b>必填</b></span>
          <input v-model="draft.attributes.era" type="text" />
          <small v-if="fieldIssue('attributes.era')">{{
            fieldIssue('attributes.era')
          }}</small>
        </label>
        <label class="worldview-field">
          <span>环境特征 <b>必填</b></span>
          <textarea v-model="draft.attributes.environment" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.environment')">
            {{ fieldIssue('attributes.environment') }}
          </small>
        </label>
      </div>

      <div v-else-if="draft.type === '组织'" class="worldview-form-grid">
        <label class="worldview-field is-wide">
          <span>组织目标 <b>必填</b></span>
          <textarea v-model="draft.attributes.purpose" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.purpose')">
            {{ fieldIssue('attributes.purpose') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>权力范围 <b>必填</b></span>
          <textarea v-model="draft.attributes.authority" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.authority')">
            {{ fieldIssue('attributes.authority') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>所在地</span>
          <select v-model="draft.attributes.locationId">
            <option :value="null">未指定</option>
            <option
              v-for="location in locationOptions"
              :key="location.id"
              :value="location.id"
            >
              {{ location.name }}
            </option>
          </select>
          <small v-if="fieldIssue('attributes.locationId')">
            {{ fieldIssue('attributes.locationId') }}
          </small>
        </label>
      </div>

      <div v-else-if="draft.type === '角色'" class="worldview-form-grid">
        <label class="worldview-field">
          <span>关联角色资产 <b>必填</b></span>
          <select v-model="draft.attributes.roleAssetId">
            <option value="">请选择角色资产</option>
            <option v-for="role in roleAssets" :key="role.id" :value="role.id">
              {{ role.name }} · {{ role.role }}
            </option>
          </select>
          <small v-if="fieldIssue('attributes.roleAssetId')">
            {{ fieldIssue('attributes.roleAssetId') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>在世界中的身份 <b>必填</b></span>
          <textarea
            v-model="draft.attributes.worldIdentity"
            rows="3"
          ></textarea>
          <small v-if="fieldIssue('attributes.worldIdentity')">
            {{ fieldIssue('attributes.worldIdentity') }}
          </small>
        </label>
        <div class="worldview-reference-note is-wide">
          <span>REFERENCE ONLY</span>
          <p>完整人设仍由“角色资产”维护，这里只保存稳定引用和世界身份。</p>
        </div>
      </div>

      <div v-else class="worldview-form-grid">
        <label class="worldview-field">
          <span>适用范围 <b>必填</b></span>
          <textarea v-model="draft.attributes.scope" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.scope')">{{
            fieldIssue('attributes.scope')
          }}</small>
        </label>
        <label class="worldview-field">
          <span>触发条件 <b>必填</b></span>
          <textarea v-model="draft.attributes.trigger" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.trigger')">
            {{ fieldIssue('attributes.trigger') }}
          </small>
        </label>
        <label class="worldview-field">
          <span>产生效果 <b>必填</b></span>
          <textarea v-model="draft.attributes.effect" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.effect')">{{
            fieldIssue('attributes.effect')
          }}</small>
        </label>
        <label class="worldview-field">
          <span>代价 <b>必填</b></span>
          <textarea v-model="draft.attributes.cost" rows="3"></textarea>
          <small v-if="fieldIssue('attributes.cost')">{{
            fieldIssue('attributes.cost')
          }}</small>
        </label>
        <label class="worldview-field is-wide">
          <span>例外 <i>每行一项</i></span>
          <textarea v-model="exceptionsText" rows="3"></textarea>
        </label>
      </div>
    </section>

    <section
      class="worldview-editor-section"
      aria-labelledby="worldview-description-field"
    >
      <div class="worldview-editor-section-title">
        <span>03</span>
        <div>
          <h5 id="worldview-description-field">补充说明</h5>
          <p>可使用富文本补充语境，但正式关系统一在事实关系清单维护。</p>
        </div>
      </div>

      <div class="worldview-description-shell">
        <div
          class="worldview-description-toolbar"
          role="toolbar"
          aria-label="补充说明富文本工具栏"
        >
          <button
            type="button"
            aria-label="加粗"
            @click="formatDescription('bold')"
          >
            <strong>B</strong>
          </button>
          <button
            type="button"
            aria-label="斜体"
            @click="formatDescription('italic')"
          >
            <em>I</em>
          </button>
          <button
            type="button"
            aria-label="项目列表"
            @click="formatDescription('insertUnorderedList')"
          >
            • —
          </button>
          <button
            type="button"
            aria-label="引用"
            @click="formatDescription('formatBlock', '<blockquote>')"
          >
            “ ”
          </button>
        </div>
        <div
          ref="descriptionEditor"
          :key="draft.id"
          class="worldview-description-editor"
          contenteditable="true"
          role="textbox"
          aria-label="补充说明富文本编辑区"
          aria-multiline="true"
          spellcheck="true"
          v-html="draft.description"
          @input="handleDescriptionInput"
        ></div>
      </div>
    </section>
  </form>
</template>

<style scoped>
.worldview-entity-editor {
  display: grid;
  gap: 0;
  min-width: 0;
  padding-bottom: 28px;
}

.worldview-editor-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 0;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-editor-kicker,
.worldview-editor-save span,
.worldview-editor-section-title > span,
.worldview-reference-note > span {
  color: var(--story-entry-blue);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.56rem;
  letter-spacing: 0.1em;
}

.worldview-editor-heading h4,
.worldview-editor-section-title h5 {
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-weight: 400;
}

.worldview-editor-heading h4 {
  margin: 7px 0 4px;
  font-size: 1.35rem;
}

.worldview-editor-heading p,
.worldview-editor-section-title p,
.worldview-reference-note p {
  margin: 0;
  color: var(--story-entry-muted);
  font-size: 0.66rem;
  line-height: 1.6;
}

.worldview-editor-save {
  display: grid;
  gap: 8px;
  justify-items: end;
}

.worldview-editor-save button {
  min-height: 32px;
  padding: 6px 14px;
  border: 1px solid var(--story-entry-blue);
  color: var(--story-entry-paper);
  background: var(--story-entry-blue);
  cursor: pointer;
  font: inherit;
  font-size: 0.68rem;
}

.worldview-editor-alert {
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin-top: 14px;
  padding: 10px 12px;
  border-left: 3px solid var(--story-entry-blue);
  background: color-mix(in srgb, var(--story-entry-blue) 9%, transparent);
  color: var(--story-entry-muted);
  font-size: 0.68rem;
}

.worldview-editor-alert strong {
  color: var(--story-entry-ink);
}

.worldview-editor-section {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
  gap: 28px;
  padding: 22px 0;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-editor-section-title {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-content: start;
}

.worldview-editor-section-title h5 {
  margin: 0 0 5px;
  font-size: 0.95rem;
}

.worldview-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  min-width: 0;
}

.worldview-field {
  display: grid;
  gap: 7px;
  align-content: start;
  min-width: 0;
  color: var(--story-entry-ink);
  font-size: 0.68rem;
}

.worldview-field.is-wide,
.worldview-reference-note.is-wide {
  grid-column: 1 / -1;
}

.worldview-field > span {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
}

.worldview-field b,
.worldview-field i {
  color: var(--story-entry-muted);
  font-family: 'IBM Plex Mono', 'SFMono-Regular', monospace;
  font-size: 0.52rem;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.05em;
}

.worldview-field input,
.worldview-field textarea,
.worldview-field select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--story-worldview-border);
  border-radius: 0;
  color: var(--story-entry-ink);
  background: color-mix(in srgb, var(--story-entry-paper) 94%, transparent);
  font: inherit;
  font-size: 0.72rem;
  outline: none;
}

.worldview-field input,
.worldview-field select {
  min-height: 38px;
  padding: 7px 9px;
}

.worldview-field textarea {
  min-height: 72px;
  resize: vertical;
  padding: 9px;
  line-height: 1.6;
}

.worldview-field input:focus,
.worldview-field textarea:focus,
.worldview-field select:focus {
  border-color: var(--story-entry-blue);
  box-shadow: inset 3px 0 0 var(--story-entry-blue);
}

.worldview-field small {
  color: var(--story-entry-blue);
  font-size: 0.6rem;
}

.worldview-reference-note {
  padding: 12px;
  border: 1px solid var(--story-worldview-border);
  border-left: 3px solid var(--story-entry-blue);
}

.worldview-reference-note p {
  margin-top: 6px;
}

.worldview-description-shell {
  min-width: 0;
  border: 1px solid var(--story-worldview-border);
}

.worldview-description-toolbar {
  display: flex;
  gap: 3px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--story-worldview-border);
}

.worldview-description-toolbar button {
  min-width: 28px;
  height: 26px;
  border: 1px solid transparent;
  color: var(--story-entry-muted);
  background: transparent;
  cursor: pointer;
  font-size: 0.66rem;
}

.worldview-description-toolbar button:hover,
.worldview-description-toolbar button:focus-visible {
  border-color: var(--story-worldview-border-strong);
  color: var(--story-entry-blue);
}

.worldview-description-editor {
  min-height: 150px;
  padding: 16px;
  color: var(--story-entry-ink);
  font-family: 'Noto Serif SC', Georgia, serif;
  font-size: 0.78rem;
  line-height: 1.75;
  outline: none;
}

@media (max-width: 820px) {
  .worldview-editor-section {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

@media (max-width: 600px) {
  .worldview-editor-heading {
    display: grid;
  }

  .worldview-editor-save {
    justify-items: stretch;
  }

  .worldview-form-grid {
    grid-template-columns: 1fr;
  }

  .worldview-field.is-wide,
  .worldview-reference-note.is-wide {
    grid-column: auto;
  }
}
</style>
