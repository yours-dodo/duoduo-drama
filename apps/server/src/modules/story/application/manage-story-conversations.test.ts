import { describe, expect, it, vi } from 'vitest';

import { AppendStoryMessage } from './append-story-message.js';
import { ArchiveStoryConversation } from './archive-story-conversation.js';
import { CreateStoryConversation } from './create-story-conversation.js';
import { ListConversationMessages } from './list-conversation-messages.js';
import { ListStoryConversations } from './list-story-conversations.js';
import { UpdateStoryConversation } from './update-story-conversation.js';
import {
  ConversationArchivedError,
  ConversationRevisionConflictError,
  StoryProjectArchivedError,
} from './story-errors.js';

const NOW = new Date('2026-08-10T03:00:00.000Z');

describe('story conversation application', () => {
  it('creates an idempotent conversation for a project editor', async () => {
    const fixture = buildFixture();
    const useCase = new CreateStoryConversation(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.idempotency,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        title: '  人物关系  ',
        idempotencyKey: 'conversation-key',
      }),
    ).resolves.toMatchObject({
      conversation: {
        id: 'conversation-id',
        title: '人物关系',
        status: 'active',
        revision: 1,
      },
    });
    expect(fixture.conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'team-id',
        projectId: 'project-id',
        title: '人物关系',
      }),
    );
  });

  it('does not create a conversation under an archived project', async () => {
    const fixture = buildFixture({
      project: projectSnapshot({ status: 'archived' }),
    });
    await expect(
      new CreateStoryConversation(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.conversations,
        fixture.idempotency,
        fixture.transactions,
        fixture.clock,
        fixture.fingerprint,
        fixture.ids,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        title: '不应创建',
        idempotencyKey: 'conversation-key',
      }),
    ).rejects.toBeInstanceOf(StoryProjectArchivedError);
  });

  it('lists conversations and messages for a project viewer', async () => {
    const fixture = buildFixture({
      actor: membership({ userId: 'reader-id' }),
      conversationPage: {
        items: [conversationSnapshot()],
        next: null,
      },
      messagePage: { items: [messageSnapshot()], next: null },
    });

    await expect(
      new ListStoryConversations(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.conversations,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
        page: { limit: 25, after: null },
      }),
    ).resolves.toMatchObject({ items: [{ id: 'conversation-id' }] });

    await expect(
      new ListConversationMessages(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.conversations,
        fixture.messages,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'reader-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        page: { limit: 25, after: null },
      }),
    ).resolves.toMatchObject({ items: [{ id: 'message-id' }] });
  });

  it('renames and archives a conversation with revision checks', async () => {
    const fixture = buildFixture();
    const update = new UpdateStoryConversation(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.transactions,
      fixture.clock,
    );
    await expect(
      update.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        title: '新版人物关系',
        expectedRevision: 1,
      }),
    ).resolves.toMatchObject({
      conversation: { title: '新版人物关系', revision: 2 },
    });

    fixture.conversation = conversationSnapshot({ revision: 2 });
    await expect(
      update.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        title: '冲突',
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(ConversationRevisionConflictError);

    const archive = new ArchiveStoryConversation(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.transactions,
      fixture.clock,
    );
    await expect(
      archive.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        expectedRevision: 2,
      }),
    ).resolves.toMatchObject({
      conversation: { status: 'archived', revision: 3 },
    });
  });

  it('appends a user message and pending generation request atomically', async () => {
    const fixture = buildFixture();
    fixture.ids.create
      .mockReset()
      .mockReturnValueOnce('message-id')
      .mockReturnValueOnce('generation-id')
      .mockReturnValueOnce('idempotency-id');
    const useCase = new AppendStoryMessage(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.messages,
      fixture.generationRequests,
      fixture.idempotency,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        body: '  请梳理人物关系  ',
        idempotencyKey: 'message-key',
      }),
    ).resolves.toMatchObject({
      message: { id: 'message-id', body: '请梳理人物关系' },
      generationRequest: { id: 'generation-id', status: 'pending' },
    });
    expect(fixture.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: '请梳理人物关系' }),
    );
    expect(fixture.generationRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerMessageId: 'message-id',
        status: 'pending',
      }),
    );
  });

  it('replays an idempotent message and rejects a different body', async () => {
    const fixture = buildFixture({
      idempotencyRecord: {
        id: 'idempotency-id',
        tenantId: 'team-id',
        scopeKey: 'tenant:team-id:user:creator-id',
        operationType: 'APPEND_STORY_MESSAGE',
        idempotencyKey: 'message-key',
        requestHash: 'hash:请梳理人物关系',
        resultId: 'message-id',
        createdAt: NOW,
      },
      message: messageSnapshot(),
      generationRequest: generationRequestSnapshot(),
    });
    const useCase = new AppendStoryMessage(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.messages,
      fixture.generationRequests,
      fixture.idempotency,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );

    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        body: '请梳理人物关系',
        idempotencyKey: 'message-key',
      }),
    ).resolves.toMatchObject({ message: { id: 'message-id' } });

    fixture.idempotencyRecord = {
      ...fixture.idempotencyRecord,
      requestHash: 'hash:其他内容',
    };
    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        body: '请梳理人物关系',
        idempotencyKey: 'message-key',
      }),
    ).rejects.toThrow('Idempotency key was already used with different input');
  });

  it('keeps archived conversation history readable but rejects new messages', async () => {
    const fixture = buildFixture({
      conversation: conversationSnapshot({ status: 'archived' }),
      messagePage: { items: [messageSnapshot()], next: null },
    });
    const useCase = new AppendStoryMessage(
      fixture.projects,
      fixture.memberships,
      fixture.collaborators,
      fixture.conversations,
      fixture.messages,
      fixture.generationRequests,
      fixture.idempotency,
      fixture.transactions,
      fixture.clock,
      fixture.fingerprint,
      fixture.ids,
    );
    await expect(
      useCase.execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        body: '不应追加',
        idempotencyKey: 'message-key',
      }),
    ).rejects.toBeInstanceOf(ConversationArchivedError);
    await expect(
      new ListConversationMessages(
        fixture.projects,
        fixture.memberships,
        fixture.collaborators,
        fixture.conversations,
        fixture.messages,
      ).execute({
        tenantId: 'team-id',
        actorUserId: 'creator-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        page: { limit: 25, after: null },
      }),
    ).resolves.toMatchObject({ items: [{ id: 'message-id' }] });
  });
});

function projectSnapshot(
  overrides: Partial<ReturnType<typeof projectSnapshot>> = {},
) {
  return {
    id: 'project-id',
    tenantId: 'team-id',
    spaceId: 'team-space-id',
    createdByUserId: 'creator-id',
    ownerUserId: 'creator-id',
    title: '故事',
    visibility: 'team' as const,
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function conversationSnapshot(
  overrides: Partial<ReturnType<typeof conversationSnapshot>> = {},
) {
  return {
    id: 'conversation-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    title: '人物关系',
    status: 'active' as const,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function messageSnapshot(
  overrides: Partial<ReturnType<typeof messageSnapshot>> = {},
) {
  return {
    id: 'message-id',
    tenantId: 'team-id',
    conversationId: 'conversation-id',
    authorType: 'user' as const,
    authorUserId: 'creator-id',
    body: '请梳理人物关系',
    createdAt: NOW,
    ...overrides,
  };
}

function generationRequestSnapshot(
  overrides: Partial<ReturnType<typeof generationRequestSnapshot>> = {},
) {
  return {
    id: 'generation-id',
    tenantId: 'team-id',
    conversationId: 'conversation-id',
    triggerMessageId: 'message-id',
    idempotencyKey: 'message-key',
    inputSnapshot: { body: '请梳理人物关系' },
    status: 'pending' as const,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-id',
    tenantId: 'team-id',
    userId: 'creator-id',
    role: 'member' as const,
    joinedAt: NOW,
    removedAt: null,
    ...overrides,
  };
}

function collaboratorSnapshot() {
  return {
    id: 'collaborator-id',
    tenantId: 'team-id',
    projectId: 'project-id',
    userId: 'writer-id',
    role: 'editor' as const,
    createdAt: NOW,
    updatedAt: NOW,
    revokedAt: null,
  };
}

function buildFixture(
  options: {
    actor?: ReturnType<typeof membership>;
    project?: ReturnType<typeof projectSnapshot> | null;
    conversation?: ReturnType<typeof conversationSnapshot> | null;
    conversationPage?: {
      items: ReturnType<typeof conversationSnapshot>[];
      next: null;
    };
    message?: ReturnType<typeof messageSnapshot> | null;
    messagePage?: { items: ReturnType<typeof messageSnapshot>[]; next: null };
    collaborator?: ReturnType<typeof collaboratorSnapshot> | null;
    idempotencyRecord?: {
      id: string;
      tenantId: string;
      scopeKey: string;
      operationType: 'APPEND_STORY_MESSAGE';
      idempotencyKey: string;
      requestHash: string;
      resultId: string;
      createdAt: Date;
    } | null;
    generationRequest?: ReturnType<typeof generationRequestSnapshot> | null;
  } = {},
) {
  const fixture = {
    actor: options.actor ?? membership(),
    project: options.project ?? projectSnapshot(),
    conversation: options.conversation ?? conversationSnapshot(),
    conversationPage: options.conversationPage ?? {
      items: [conversationSnapshot()],
      next: null,
    },
    message: options.message ?? null,
    messagePage: options.messagePage ?? { items: [], next: null },
    collaborator: options.collaborator ?? collaboratorSnapshot(),
    idempotencyRecord: options.idempotencyRecord ?? null,
    generationRequest: options.generationRequest ?? null,
    projects: {
      findById: vi.fn(async () => fixture.project),
      findByIdLocked: vi.fn(async () => fixture.project),
    },
    memberships: {
      findActive: vi.fn(async () => fixture.actor),
    },
    collaborators: {
      findByProjectAndUserLocked: vi.fn(async () => fixture.collaborator),
    },
    conversations: {
      create: vi.fn(async (value) => value),
      update: vi.fn(async (value) => value),
      findById: vi.fn(async () => fixture.conversation),
      findByIdLocked: vi.fn(async () => fixture.conversation),
      listForProject: vi.fn(async () => fixture.conversationPage),
    },
    messages: {
      create: vi.fn(async (value) => value),
      findById: vi.fn(async () => fixture.message),
      listForConversation: vi.fn(async () => fixture.messagePage),
    },
    generationRequests: {
      create: vi.fn(async (value) => value),
      findByTriggerMessageId: vi.fn(async () => fixture.generationRequest),
    },
    idempotency: {
      findLocked: vi.fn(async () => fixture.idempotencyRecord),
      create: vi.fn(async (value) => value),
    },
    transactions: { run: vi.fn(async (operation) => operation()) },
    clock: { now: vi.fn(async () => NOW) },
    fingerprint: { hash: vi.fn((value: string) => `hash:${value}`) },
    ids: {
      create: vi
        .fn()
        .mockReturnValueOnce('conversation-id')
        .mockReturnValueOnce('idempotency-id')
        .mockReturnValueOnce('message-id')
        .mockReturnValueOnce('generation-id'),
    },
  };
  return fixture;
}
