import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendStoryMessage,
  appendPersonalStoryMessage,
  confirmStoryDraft,
  createPersonalStoryConversation,
  createPersonalStoryImportJob,
  createPersonalStoryProject,
  createStoryConversation,
  createStoryProject,
  listPersonalStoryProjects,
  listStoryProjects,
} from './story-api';

describe('story API adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists personal-space projects without a team context', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listPersonalStoryProjects(20);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/story-projects?limit=20',
      expect.objectContaining({ credentials: 'include' }),
    );
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

  it('adds idempotency to project, conversation, and draft mutations', async () => {
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
    await createStoryConversation(
      'team-1',
      'project-1',
      { title: '第一次创作对话' },
      'conversation-key',
    );
    await appendStoryMessage(
      'team-1',
      'project-1',
      'conversation-1',
      '一个发生在旧车站的故事',
      'message-key',
    );
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
        body: JSON.stringify({
          title: '新故事',
          creationMode: 'standard',
          visibility: 'team',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/teams/team-1/story-projects/project-1/conversations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'conversation-key',
        },
        body: JSON.stringify({ title: '第一次创作对话' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/teams/team-1/story-projects/project-1/conversations/conversation-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'message-key',
        },
        body: JSON.stringify({ body: '一个发生在旧车站的故事' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
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

  it('creates a private project in the personal space', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ project: { id: 'personal-project-1' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPersonalStoryProject({ title: '个人故事' }, 'personal-key');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/story-projects',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'personal-key',
        },
        body: JSON.stringify({
          title: '个人故事',
          creationMode: 'standard',
        }),
      }),
    );
  });

  it('registers a selected personal story file as an import job', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ importJob: { id: 'import-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPersonalStoryImportJob(
      'project-1',
      { name: '旧故事.md', type: 'text/markdown', size: 1024 },
      'import-key',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/me/story-projects/project-1/import-jobs',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'import-key',
        },
        body: JSON.stringify({
          fileName: '旧故事.md',
          contentType: 'text/markdown',
          byteSize: 1024,
        }),
      }),
    );
  });

  it('sends a personal-space story prompt through personal endpoints', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ conversation: { id: 'conversation-1' } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPersonalStoryConversation(
      'project-1',
      {
        title: '第一次创作对话',
      },
      'personal-conversation-key',
    );
    await appendPersonalStoryMessage(
      'project-1',
      'conversation-1',
      '一个发生在旧车站的故事',
      'personal-message-key',
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/me/story-projects/project-1/conversations',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'personal-conversation-key',
        },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/story-projects/project-1/conversations/conversation-1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'personal-message-key',
        },
      }),
    );
  });
});
