import { createMemoryHistory } from 'vue-router';
import { describe, expect, it } from 'vitest';

import {
  createStoryRouter,
  isStoryModule,
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

  it('recognizes only the four story modules', () => {
    expect(isStoryModule('outline')).toBe(true);
    expect(isStoryModule('roles')).toBe(true);
    expect(isStoryModule('worldview')).toBe(true);
    expect(isStoryModule('story')).toBe(true);
    expect(isStoryModule('characters')).toBe(false);
  });
});
