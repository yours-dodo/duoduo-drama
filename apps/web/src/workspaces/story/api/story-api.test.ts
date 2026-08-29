import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  archivePersonalStoryRoleAsset,
  archivePersonalStoryProject,
  appendStoryMessage,
  appendPersonalStoryMessage,
  confirmStoryDraft,
  createPersonalStoryConversation,
  createPersonalStoryImportJob,
  createPersonalStoryAssetUploadUrl,
  completePersonalStoryAssetUpload,
  createPersonalStoryProject,
  createPersonalStoryRoleAsset,
  createStoryConversation,
  createStoryProject,
  listPersonalStoryProjects,
  listPersonalStoryRoleAssets,
  listStoryProjects,
  getStoryOutline,
  saveStoryOutline,
  restoreStoryProject,
  updatePersonalStoryRoleAsset,
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

  it('reads and saves the normalized outline through the matching scope endpoint', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            artifact: { id: 'artifact-1' },
            currentVersion: null,
            version: { id: 'version-1' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await getStoryOutline({ teamId: 'team-1', projectId: 'project-1' });
    await saveStoryOutline(
      { projectId: 'personal-project-1' },
      {
        content: '{"schemaVersion":"narrative-planning.v1"}',
        expectedVersionNumber: 3,
      },
      'outline-save-key',
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/teams/team-1/story-projects/project-1/outline',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/story-projects/personal-project-1/outline',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          'Idempotency-Key': 'outline-save-key',
        }),
        body: JSON.stringify({
          content: '{"schemaVersion":"narrative-planning.v1"}',
          expectedVersionNumber: 3,
        }),
      }),
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

  it('archives and restores projects through the matching scope endpoint', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ project: { id: 'project-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await archivePersonalStoryProject('project-1', 4);
    await restoreStoryProject('team-1', 'project-1', 5);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/me/story-projects/project-1/archive',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 4 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/teams/team-1/story-projects/project-1/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 5 }),
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

  it('uses server-generated role ids and revision-aware role mutations', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(
          init?.method === 'DELETE'
            ? null
            : JSON.stringify({
                items: [],
                roleAsset: {
                  id: '30000000-0000-4000-8000-000000000001',
                },
              }),
          {
            status: init?.method === 'DELETE' ? 204 : 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await listPersonalStoryRoleAssets('project-1');
    await createPersonalStoryRoleAsset(
      'project-1',
      { category: 'protagonists', name: '林遥' },
      'role-key',
    );
    await updatePersonalStoryRoleAsset('project-1', 'role-1', {
      name: '林遥（新版）',
      expectedRevision: 1,
    });
    await archivePersonalStoryRoleAsset('project-1', 'role-1', 2);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/story-projects/project-1/role-assets',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'role-key' }),
        body: JSON.stringify({ category: 'protagonists', name: '林遥' }),
      }),
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)),
    ).not.toHaveProperty('id');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/v1/me/story-projects/project-1/role-assets/role-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: '林遥（新版）', expectedRevision: 1 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/v1/me/story-projects/project-1/role-assets/role-1?expectedRevision=2',
      expect.objectContaining({ method: 'DELETE' }),
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

  it('uses the project asset endpoints for cover upload registration and completion', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            asset: { id: 'asset-1', status: 'pending_upload' },
            uploadUrl: 'https://storage.test/upload',
            expiresAt: '2026-08-20T10:10:00.000Z',
            requiredHeaders: { 'content-type': 'image/png' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await createPersonalStoryAssetUploadUrl('project-1', {
      fileName: '林遥.png',
      contentType: 'image/png',
      byteSize: 2048,
    });
    await completePersonalStoryAssetUpload('project-1', 'asset-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/me/story-projects/project-1/assets/upload-url',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          fileName: '林遥.png',
          contentType: 'image/png',
          byteSize: 2048,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/me/story-projects/project-1/assets/asset-1/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
