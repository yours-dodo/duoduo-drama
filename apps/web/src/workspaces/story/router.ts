import {
  createMemoryHistory,
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import { defineComponent, h } from 'vue';

const StoryRoutePlaceholder = defineComponent({
  name: 'StoryRoutePlaceholder',
  setup() {
    return () =>
      h('div', { class: 'story-router-placeholder' }, [
        h('span', { 'aria-hidden': 'true' }, '✦'),
        h('span', '故事工作台'),
      ]);
  },
});

export const storyModules = [
  'basic',
  'worldview',
  'roles',
  'outline',
  'story',
] as const;

export type StoryModule = (typeof storyModules)[number];
export type StoryCreationMode = 'story' | 'immersive';
export type StoryWorldviewView = 'settings' | 'composition';

export type StoryRouteMeta = {
  mode?: StoryCreationMode;
  page?: 'catalog' | 'immersive' | 'templates' | 'project' | 'not-found';
  module?: StoryModule;
  worldviewView?: StoryWorldviewView;
};

export const storyRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'stories-catalog',
    component: () => import('./StoryCatalogView.vue'),
    meta: { page: 'catalog' } satisfies StoryRouteMeta,
  },
  {
    path: '/immersive',
    name: 'stories-immersive',
    component: () => import('./StoryImmersiveView.vue'),
    meta: { page: 'immersive' } satisfies StoryRouteMeta,
  },
  {
    path: '/templates',
    name: 'stories-templates',
    component: () => import('./StoryTemplatesView.vue'),
    meta: { page: 'templates' } satisfies StoryRouteMeta,
  },
  {
    path: '/immersive/:projectId',
    name: 'stories-immersive-project',
    redirect: (to) => `${to.path}/outline`,
    meta: { mode: 'immersive', page: 'project' } satisfies StoryRouteMeta,
  },
  {
    path: '/immersive/:projectId/:module',
    name: 'stories-immersive-project-module',
    component: () => import('./StoryProjectView.vue'),
    beforeEnter: (to) => validateProjectModule(to, 'immersive'),
    meta: { mode: 'immersive', page: 'project' } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId',
    name: 'stories-project',
    redirect: (to) => `${to.path}/outline`,
    meta: { mode: 'story', page: 'project' } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId/worldview',
    name: 'stories-project-worldview',
    redirect: (to) =>
      `/${encodeURIComponent(String(to.params.projectId))}/worldview/settings`,
    meta: {
      mode: 'story',
      page: 'project',
      module: 'worldview',
    } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId/worldview/composition/:entityId/edit',
    name: 'stories-project-worldview-entity-edit',
    component: () => import('./StoryWorldviewEntityEditView.vue'),
    meta: {
      mode: 'story',
      page: 'project',
      module: 'worldview',
      worldviewView: 'composition',
    } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId/worldview/:worldviewView',
    name: 'stories-project-worldview-view',
    component: () => import('./StoryProjectView.vue'),
    beforeEnter: validateWorldviewView,
    meta: {
      mode: 'story',
      page: 'project',
      module: 'worldview',
    } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId/roles/:roleId/edit',
    name: 'stories-project-role-edit',
    component: () => import('./StoryRoleEditView.vue'),
    beforeEnter: validateRoleId,
    meta: {
      mode: 'story',
      page: 'project',
      module: 'roles',
    } satisfies StoryRouteMeta,
  },
  {
    path: '/:projectId/:module',
    name: 'stories-project-module',
    component: () => import('./StoryProjectView.vue'),
    beforeEnter: (to) => validateProjectModule(to, 'story'),
    meta: { mode: 'story', page: 'project' } satisfies StoryRouteMeta,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'stories-not-found',
    component: StoryRoutePlaceholder,
    meta: { page: 'not-found' } satisfies StoryRouteMeta,
  },
];

export type CreateStoryRouterOptions = {
  history?: RouterHistory;
  initialPath?: string;
};

export function createStoryRouter(options: CreateStoryRouterOptions = {}) {
  const history =
    options.history ??
    (typeof window === 'undefined'
      ? createMemoryHistory('/stories')
      : createWebHistory('/stories'));

  const router = createRouter({
    history,
    routes: storyRoutes,
    scrollBehavior: () => ({ top: 0 }),
  });

  if (options.initialPath) {
    void router.replace(toStoryRoutePath(options.initialPath));
  }

  return router;
}

export function toStoryRoutePath(pathname: string): string {
  const url = pathname.startsWith('http')
    ? new URL(pathname)
    : new URL(pathname, 'http://stories.local');
  const basePath = '/stories';
  const path = url.pathname.startsWith(basePath)
    ? url.pathname.slice(basePath.length) || '/'
    : url.pathname;
  return `${path.startsWith('/') ? path : `/${path}`}${url.search}${url.hash}`;
}

function validateProjectModule(
  to: RouteLocationNormalized,
  mode: StoryCreationMode,
) {
  const module = String(to.params.module);
  if (isStoryModule(module)) return true;
  const prefix = mode === 'immersive' ? '/immersive/' : '/';
  return `${prefix}${encodeURIComponent(String(to.params.projectId))}/outline`;
}

function validateWorldviewView(to: RouteLocationNormalized) {
  const view = String(to.params.worldviewView);
  if (view === 'settings' || view === 'composition') return true;
  return `/${encodeURIComponent(String(to.params.projectId))}/worldview/settings`;
}

function validateRoleId(to: RouteLocationNormalized) {
  const roleId = String(to.params.roleId);
  if (UUID_V4_PATTERN.test(roleId)) return true;
  return `/${encodeURIComponent(String(to.params.projectId))}/roles`;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStoryModule(value: string): value is StoryModule {
  return storyModules.includes(value as StoryModule);
}
