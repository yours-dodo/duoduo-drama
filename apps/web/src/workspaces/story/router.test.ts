import { createMemoryHistory } from 'vue-router';
import { describe, expect, it } from 'vitest';

import {
  createStoryRouter,
  isStoryModule,
  storyModules,
  toStoryRoutePath,
} from './router';

describe('story router', () => {
  it('normalizes browser paths relative to /stories', () => {
    expect(toStoryRoutePath('/stories')).toBe('/');
    expect(toStoryRoutePath('/stories/templates?tab=featured')).toBe(
      '/templates?tab=featured',
    );
    expect(
      toStoryRoutePath(
        'https://example.test/stories/immersive/project-1/story?import=pending',
      ),
    ).toBe('/immersive/project-1/story?import=pending');
  });

  it('matches catalog, templates, and both project modes', async () => {
    const router = createStoryRouter({
      history: createMemoryHistory('/stories'),
    });

    expect(router.resolve('/').name).toBe('stories-catalog');

    expect(router.resolve('/templates').name).toBe('stories-templates');

    await router.push('/project-1/roles');
    expect(router.currentRoute.value.name).toBe('stories-project-module');
    expect(router.currentRoute.value.meta.mode).toBe('story');
    expect(router.currentRoute.value.params.module).toBe('roles');

    await router.push('/immersive/project-2/worldview');
    expect(router.currentRoute.value.name).toBe(
      'stories-immersive-project-module',
    );
    expect(router.currentRoute.value.meta.mode).toBe('immersive');
  });

  it('redirects project roots and invalid modules to outline', async () => {
    const router = createStoryRouter({
      history: createMemoryHistory('/stories'),
    });

    await router.push('/project-1');
    expect(router.currentRoute.value.fullPath).toBe('/project-1/outline');

    await router.push('/immersive/project-2');
    expect(router.currentRoute.value.fullPath).toBe(
      '/immersive/project-2/outline',
    );

    await router.push('/project-1/not-a-module');
    expect(router.currentRoute.value.fullPath).toBe('/project-1/outline');
  });

  it('matches UUID role edit pages and redirects legacy user-defined IDs', async () => {
    const router = createStoryRouter({
      history: createMemoryHistory('/stories'),
    });

    const roleId = '19c15e23-335a-49dd-80e6-546665093c70';
    const route = router.resolve(`/project-1/roles/${roleId}/edit`);
    expect(route.name).toBe('stories-project-role-edit');
    expect(route.params).toMatchObject({
      projectId: 'project-1',
      roleId,
    });
    expect(route.meta).toMatchObject({
      mode: 'story',
      page: 'project',
      module: 'roles',
    });

    await router.push('/project-1/roles/lin-yao/edit');
    expect(router.currentRoute.value.fullPath).toBe('/project-1/roles');
  });

  it('maps worldview subroutes to their tabs and entity edit page', async () => {
    const router = createStoryRouter({
      history: createMemoryHistory('/stories'),
    });

    await router.push('/project-1/worldview');
    expect(router.currentRoute.value.fullPath).toBe(
      '/project-1/worldview/settings',
    );

    await router.push('/project-1/worldview/settings');
    expect(router.currentRoute.value.name).toBe(
      'stories-project-worldview-view',
    );
    expect(router.currentRoute.value.params.worldviewView).toBe('settings');
    expect(router.currentRoute.value.meta.module).toBe('worldview');

    await router.push('/project-1/worldview/composition');
    expect(router.currentRoute.value.params.worldviewView).toBe('composition');

    await router.push('/project-1/worldview/composition/fog-city/edit');
    expect(router.currentRoute.value.name).toBe(
      'stories-project-worldview-entity-edit',
    );
    expect(router.currentRoute.value.params).toMatchObject({
      projectId: 'project-1',
      entityId: 'fog-city',
    });
    expect(router.currentRoute.value.meta).toMatchObject({
      module: 'worldview',
      worldviewView: 'composition',
    });

    await router.push('/project-1/worldview/not-a-view');
    expect(router.currentRoute.value.fullPath).toBe(
      '/project-1/worldview/settings',
    );
  });

  it('recognizes the five story modules', () => {
    expect(storyModules).toEqual([
      'basic',
      'worldview',
      'roles',
      'outline',
      'story',
    ]);
    expect(isStoryModule('basic')).toBe(true);
    expect(isStoryModule('outline')).toBe(true);
    expect(isStoryModule('roles')).toBe(true);
    expect(isStoryModule('worldview')).toBe(true);
    expect(isStoryModule('story')).toBe(true);
    expect(isStoryModule('characters')).toBe(false);
  });
});
