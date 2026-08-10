import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../../../test/create-test-app.js';
import { SESSION_COOKIE_NAME } from '../../identity/http/session-auth.guard.js';
import { IDENTITY_TOKEN_SECURITY } from '../../identity/ports/identity-token-security.js';
import { SESSION_REPOSITORY } from '../../identity/ports/session-repository.js';
import { TEAM_MEMBERSHIP_REPOSITORY } from '../../tenancy/ports/team-membership-repository.js';
import { AppendStoryMessage } from '../application/append-story-message.js';
import { ArchiveStoryConversation } from '../application/archive-story-conversation.js';
import { ConversationRevisionConflictError } from '../application/story-errors.js';
import { CreateStoryConversation } from '../application/create-story-conversation.js';
import { GenerateStoryDraft } from '../application/generate-story-draft.js';
import { ListConversationMessages } from '../application/list-conversation-messages.js';
import { ListStoryConversations } from '../application/list-story-conversations.js';
import { UpdateStoryConversation } from '../application/update-story-conversation.js';

const TEAM_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const CONVERSATION_ID = '30000000-0000-4000-8000-000000000001';
const USER_ID = '40000000-0000-4000-8000-000000000001';
const SESSION_TOKEN = 's'.repeat(43);
const NOW = new Date('2026-08-10T05:00:00.000Z');

describe('story conversation HTTP API', () => {
  let app: INestApplication;
  let useCases: Record<string, { execute: ReturnType<typeof vi.fn> }>;

  beforeEach(async () => {
    useCases = {
      create: executable({
        conversation: {
          id: CONVERSATION_ID,
          tenantId: TEAM_ID,
          projectId: PROJECT_ID,
          title: '人物关系',
          status: 'active',
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
      list: executable({ items: [], next: null }),
      update: executable({
        conversation: { id: CONVERSATION_ID, revision: 2 },
      }),
      archive: executable({
        conversation: { id: CONVERSATION_ID, status: 'archived' },
      }),
      messages: executable({ items: [], next: null }),
      append: executable({
        message: { id: 'message-id', body: '请梳理人物关系' },
        generationRequest: { id: 'generation-id', status: 'pending' },
      }),
      generate: executable({
        message: { id: 'agent-message-id', authorType: 'agent' },
        generationRequest: { id: 'generation-id', status: 'succeeded' },
        artifact: { id: 'artifact-id' },
        artifactVersion: { id: 'version-id' },
      }),
    };

    app = await createTestApp({
      providerOverrides: [
        { token: CreateStoryConversation, value: useCases.create },
        { token: ListStoryConversations, value: useCases.list },
        { token: UpdateStoryConversation, value: useCases.update },
        { token: ArchiveStoryConversation, value: useCases.archive },
        { token: ListConversationMessages, value: useCases.messages },
        { token: AppendStoryMessage, value: useCases.append },
        { token: GenerateStoryDraft, value: useCases.generate },
        {
          token: TEAM_MEMBERSHIP_REPOSITORY,
          value: {
            findActive: vi.fn(async () => ({
              id: 'membership-id',
              tenantId: TEAM_ID,
              userId: USER_ID,
              role: 'admin',
              joinedAt: NOW,
              removedAt: null,
            })),
          },
        },
        {
          token: SESSION_REPOSITORY,
          value: {
            findActiveByTokenHash: vi.fn(async () => ({
              id: 'session-id',
              userId: USER_ID,
              email: 'creator@example.com',
              expiresAt: new Date('2026-09-10T00:00:00.000Z'),
            })),
          },
        },
        {
          token: IDENTITY_TOKEN_SECURITY,
          value: { hashSessionToken: vi.fn(() => 'session-hash') },
        },
      ],
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('exposes conversation and message resources', async () => {
    const auth = (builder: request.Test) =>
      builder.set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`);
    const write = (builder: request.Test) =>
      auth(builder).set('Origin', 'http://localhost:3000');
    const conversationsPath = `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/conversations`;

    await write(request(app.getHttpServer()).post(conversationsPath))
      .set('Idempotency-Key', 'conversation-key')
      .send({ title: '人物关系' })
      .expect(201);
    await auth(request(app.getHttpServer()).get(conversationsPath))
      .query({ limit: 25 })
      .expect(200, { items: [], nextCursor: null });
    await write(
      request(app.getHttpServer()).patch(
        `${conversationsPath}/${CONVERSATION_ID}`,
      ),
    )
      .send({ title: '新版人物关系', expectedRevision: 1 })
      .expect(200);
    await write(
      request(app.getHttpServer()).post(
        `${conversationsPath}/${CONVERSATION_ID}/archive`,
      ),
    )
      .send({ expectedRevision: 2 })
      .expect(200);

    const messagesPath = `${conversationsPath}/${CONVERSATION_ID}/messages`;
    await auth(request(app.getHttpServer()).get(messagesPath))
      .query({ limit: 25 })
      .expect(200, { items: [], nextCursor: null });
    await write(request(app.getHttpServer()).post(messagesPath))
      .set('Idempotency-Key', 'message-key')
      .send({ body: '请梳理人物关系' })
      .expect(201);

    expect(useCases.create.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TEAM_ID,
        actorUserId: USER_ID,
        projectId: PROJECT_ID,
        idempotencyKey: 'conversation-key',
      }),
    );
    expect(useCases.append.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        body: '请梳理人物关系',
        idempotencyKey: 'message-key',
      }),
    );
  });

  it('maps conversation revision conflicts and validates message input', async () => {
    useCases.update.execute.mockRejectedValueOnce(
      new ConversationRevisionConflictError(),
    );
    const conflict = await request(app.getHttpServer())
      .patch(
        `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/conversations/${CONVERSATION_ID}`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('x-request-id', 'conversation-revision-request')
      .send({ title: '冲突标题', expectedRevision: 1 })
      .expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'CONVERSATION_REVISION_CONFLICT',
      requestId: 'conversation-revision-request',
    });

    await request(app.getHttpServer())
      .post(
        `/v1/teams/${TEAM_ID}/story-projects/${PROJECT_ID}/conversations/${CONVERSATION_ID}/messages`,
      )
      .set('Cookie', `${SESSION_COOKIE_NAME}=${SESSION_TOKEN}`)
      .set('Origin', 'http://localhost:3000')
      .set('Idempotency-Key', 'invalid-message')
      .send({ body: '' })
      .expect(400);
  });
});

function executable(result: unknown) {
  return { execute: vi.fn(async () => result) };
}
