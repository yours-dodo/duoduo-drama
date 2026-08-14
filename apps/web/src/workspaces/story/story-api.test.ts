import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  confirmStoryDraft,
  createStoryProject,
  listStoryProjects,
} from './story-api';

describe('story API adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps project listing behind the Web server-api boundary', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'project-1',
                title: '有封面的故事',
                coverUrl: 'https://cdn.example.test/cover.jpg',
              },
            ],
            nextCursor: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await listStoryProjects('team-1', 25);

    expect(result.items[0]?.coverUrl).toBe(
      'https://cdn.example.test/cover.jpg',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/teams/team-1/story-projects?limit=25',
      expect.objectContaining({
        credentials: 'include',
        headers: { Accept: 'application/json' },
      }),
    );
  });

  it('adds idempotency to project creation and draft confirmation', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            project: { id: 'project-1' },
            version: { id: 'version-1' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createStoryProject('team-1', { title: '新故事' }, 'create-key');
    await confirmStoryDraft(
      'team-1',
      'project-1',
      'artifact-1',
      'version-1',
      3,
      'confirm-key',
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/teams/team-1/story-projects',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'create-key',
        },
        body: JSON.stringify({ title: '新故事', visibility: 'team' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/teams/team-1/story-projects/project-1/artifacts/artifact-1/drafts/version-1/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'confirm-key',
        },
        body: JSON.stringify({ expectedVersionNumber: 3 }),
      }),
    );
  });
});
