<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import {
  createProjectStoryRoleAsset,
  listProjectStoryRoleAssets,
} from '../../../../api/story-role-api';
import {
  groupStoryRoleAssets,
  storyRoleCategoryLabel,
  type StoryRoleGroup,
} from './story-role-assets';
import {
  storyEraFromWorldview,
  storyRolePlaceholderUrl,
} from './story-role-placeholder';
import { useStoryWorldviewStateRegistry } from '../worldview/story-worldview-state';
import type {
  StoryRoleAsset,
  StoryRoleCategory,
} from '../../../../api/story-api';

const route = useRoute();
const router = useRouter();
const worldviewStateRegistry = useStoryWorldviewStateRegistry();
const projectId = computed(() => String(route.params.projectId ?? ''));
const teamId = computed(() => {
  const value = route.query.teamId;
  return typeof value === 'string' && value ? value : null;
});
const scope = computed(() => ({
  projectId: projectId.value,
  teamId: teamId.value,
}));
const roles = ref<StoryRoleAsset[]>([]);
const groups = computed<StoryRoleGroup[]>(() =>
  groupStoryRoleAssets(roles.value),
);
const storyEra = computed(() =>
  storyEraFromWorldview(worldviewStateRegistry.getGraph(projectId.value)),
);
const viewState = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
const creatingCategory = ref<StoryRoleCategory | null>(null);
const expandedRoleId = ref<string | null>(null);
const collapsingRoleIds = ref<Set<string>>(new Set());
const expansionSideByRole = ref<Record<string, 'left' | 'right'>>({});
const expansionMetricsByRole = ref<
  Record<
    string,
    { baseWidth: number; baseHeight: number; expandedWidth: number }
  >
>({});
const EXPANDED_CARD_MIN_WIDTH = 480;
const EXPANDED_DETAILS_WIDTH = 240;
const CARD_COLLAPSE_DURATION = 240;
const collapseTimers = new Map<string, number>();

onBeforeUnmount(clearCollapseTimers);

watch(
  scope,
  () => {
    void loadRoles();
  },
  { immediate: true },
);

async function loadRoles() {
  viewState.value = 'loading';
  errorMessage.value = '';
  try {
    roles.value = (await listProjectStoryRoleAssets(scope.value)).items;
    viewState.value = 'ready';
  } catch {
    roles.value = [];
    errorMessage.value = '角色资产加载失败，请检查网络后重试。';
    viewState.value = 'error';
  }
}

async function createRole(group: StoryRoleGroup) {
  if (creatingCategory.value !== null) return;
  creatingCategory.value = group.id;
  errorMessage.value = '';
  try {
    const { roleAsset } = await createProjectStoryRoleAsset(scope.value, {
      category: group.id,
      name: `未命名${group.label}`,
    });
    await router.push(roleEditLocation(roleAsset.id));
  } catch {
    errorMessage.value = '角色创建失败，请稍后重试。';
  } finally {
    creatingCategory.value = null;
  }
}

function roleEditLocation(roleId: string) {
  return {
    path: `/${encodeURIComponent(projectId.value)}/roles/${encodeURIComponent(roleId)}/edit`,
    query: teamId.value ? { teamId: teamId.value } : undefined,
  };
}

function updateExpansionSide(roleId: string, event: MouseEvent | FocusEvent) {
  const card = event.currentTarget;
  if (!(card instanceof HTMLElement)) return;
  cancelRoleCollapse(roleId);
  const grid = card.closest('.story-role-card-grid');
  const bounds = grid?.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const baseWidth = Math.round(cardBounds.width);
  const baseHeight = Math.round(cardBounds.height);
  const expandedWidth = Math.min(
    Math.max(EXPANDED_CARD_MIN_WIDTH, baseWidth + EXPANDED_DETAILS_WIDTH),
    window.innerWidth - 36,
  );
  expansionMetricsByRole.value[roleId] = {
    baseWidth,
    baseHeight,
    expandedWidth,
  };
  const availableRight =
    (bounds?.right ?? window.innerWidth) - cardBounds.right;
  const requiredExpansion = Math.max(0, expandedWidth - cardBounds.width);
  expansionSideByRole.value[roleId] =
    availableRight >= requiredExpansion ? 'right' : 'left';
  expandedRoleId.value = roleId;
}

function expansionStyle(roleId: string): Record<string, string> | undefined {
  const metrics = expansionMetricsByRole.value[roleId];
  if (!metrics) return undefined;
  return {
    '--story-role-base-width': `${metrics.baseWidth}px`,
    '--story-role-base-height': `${metrics.baseHeight}px`,
    '--story-role-expanded-width': `${metrics.expandedWidth}px`,
  };
}

function clearExpandedRole(roleId: string, event: MouseEvent | FocusEvent) {
  const card = event.currentTarget;
  if (!(card instanceof HTMLElement)) return;
  if (
    event.relatedTarget instanceof Node &&
    card.contains(event.relatedTarget)
  ) {
    return;
  }
  if (expandedRoleId.value !== roleId) return;
  cancelRoleCollapse(roleId);
  setRoleCollapsing(roleId, true);
  const collapseTimer = window.setTimeout(() => {
    if (expandedRoleId.value === roleId) expandedRoleId.value = null;
    collapseTimers.delete(roleId);
    setRoleCollapsing(roleId, false);
  }, CARD_COLLAPSE_DURATION);
  collapseTimers.set(roleId, collapseTimer);
}

function setRoleCollapsing(roleId: string, isCollapsing: boolean) {
  const next = new Set(collapsingRoleIds.value);
  if (isCollapsing) next.add(roleId);
  else next.delete(roleId);
  collapsingRoleIds.value = next;
}

function cancelRoleCollapse(roleId: string) {
  const timer = collapseTimers.get(roleId);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    collapseTimers.delete(roleId);
  }
  setRoleCollapsing(roleId, false);
}

function clearCollapseTimers() {
  for (const timer of collapseTimers.values()) window.clearTimeout(timer);
  collapseTimers.clear();
  collapsingRoleIds.value = new Set();
}
</script>

<template>
  <section
    class="story-roles-workspace"
    aria-labelledby="story-roles-workspace-title"
  >
    <h2 id="story-roles-workspace-title" class="sr-only">角色资产库</h2>

    <div
      v-if="viewState === 'loading'"
      class="story-role-list-state"
      role="status"
    >
      正在加载角色资产…
    </div>

    <div v-else-if="viewState === 'error'" class="story-role-list-state">
      <p>{{ errorMessage }}</p>
      <button type="button" @click="loadRoles">重新加载</button>
    </div>

    <div v-else class="story-role-groups">
      <p v-if="errorMessage" class="story-role-list-error" role="alert">
        {{ errorMessage }}
      </p>

      <section
        v-for="group in groups"
        :key="group.id"
        class="story-role-group"
        :aria-labelledby="`story-role-group-${group.id}`"
      >
        <header class="story-role-group-header">
          <div>
            <h3 :id="`story-role-group-${group.id}`">{{ group.label }}</h3>
          </div>
          <button
            class="story-role-group-create"
            type="button"
            :disabled="creatingCategory !== null"
            @click="createRole(group)"
          >
            {{
              creatingCategory === group.id ? '创建中…' : `新增${group.label}`
            }}
          </button>
        </header>

        <p v-if="group.roles.length === 0" class="story-role-group-empty">
          还没有{{ group.label }}，创建后会由服务器分配 UUID。
        </p>

        <div v-else class="story-role-card-grid">
          <article
            v-for="role in group.roles"
            :key="role.id"
            class="story-role-card"
            :class="{
              'is-expanded':
                expandedRoleId === role.id || collapsingRoleIds.has(role.id),
              'is-collapsing': collapsingRoleIds.has(role.id),
              'is-expand-left': expansionSideByRole[role.id] === 'left',
            }"
            :style="expansionStyle(role.id)"
            @mouseenter="updateExpansionSide(role.id, $event)"
            @mouseleave="clearExpandedRole(role.id, $event)"
            @focusin="updateExpansionSide(role.id, $event)"
            @focusout="clearExpandedRole(role.id, $event)"
          >
            <RouterLink
              class="story-role-card-link"
              :to="roleEditLocation(role.id)"
              :aria-label="`编辑角色：${role.name}`"
            >
              <div class="story-role-card-visual">
                <header class="story-role-card-header">
                  <div class="story-role-card-cover" aria-hidden="true">
                    <img
                      v-if="role.coverAsset?.downloadUrl"
                      :src="role.coverAsset.downloadUrl"
                      :alt="`${role.name}封面图`"
                    />
                    <img
                      v-else
                      :src="storyRolePlaceholderUrl(role.gender, storyEra)"
                      :alt="`${storyEra}时代${role.name}默认占位图`"
                    />
                  </div>
                </header>
                <div class="story-role-card-caption">
                  <h4>{{ role.name }}</h4>
                </div>
              </div>
              <div class="story-role-card-details">
                <span class="story-role-card-details-kicker">角色设定</span>
                <dl class="story-role-card-details-meta">
                  <div>
                    <dt>定位</dt>
                    <dd>{{ storyRoleCategoryLabel(role.category) }}</dd>
                  </div>
                  <div>
                    <dt>性别</dt>
                    <dd>{{ role.gender }}</dd>
                  </div>
                  <div>
                    <dt>身份</dt>
                    <dd>{{ role.occupation || '未设定' }}</dd>
                  </div>
                  <div>
                    <dt>阵营</dt>
                    <dd>{{ role.camp }}</dd>
                  </div>
                  <div>
                    <dt>频率</dt>
                    <dd>{{ role.appearanceFrequency }}</dd>
                  </div>
                </dl>
                <dl class="story-role-card-details-copy">
                  <div>
                    <dt>性格</dt>
                    <dd :title="role.personalityCore || '未设定'">
                      {{ role.personalityCore || '未设定' }}
                    </dd>
                  </div>
                  <div>
                    <dt>动机</dt>
                    <dd :title="role.motivationConflict || '未设定'">
                      {{ role.motivationConflict || '未设定' }}
                    </dd>
                  </div>
                  <div>
                    <dt>主线</dt>
                    <dd :title="role.mainlineRelation || '未设定'">
                      {{ role.mainlineRelation || '未设定' }}
                    </dd>
                  </div>
                </dl>
                <span class="story-role-card-details-action">进入角色详情</span>
              </div>
            </RouterLink>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
