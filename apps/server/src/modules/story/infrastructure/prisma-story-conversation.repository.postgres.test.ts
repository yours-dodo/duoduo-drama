import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import type { ConversationSnapshot } from '../../../domain/story/conversation.js';
import type { MessageSnapshot } from '../../../domain/story/message.js';
import { StoryGenerationRequest } from '../../../domain/story/story-generation-request.js';
import type { StoryGenerationRequestSnapshot } from '../../../domain/story/story-generation-request.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaConversationRepository } from './prisma-conversation.repository.js';
import { PrismaMessageRepository } from './prisma-message.repository.js';
import { PrismaStoryGenerationRequestRepository } from './prisma-story-generation-request.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-10T03:30:00.000Z');

describe.skipIf(!databaseUrl)('story conversation PostgreSQL boundary', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let conversations: PrismaConversationRepository;
  let messages: PrismaMessageRepository;
  let generationRequests: PrismaStoryGenerationRequestRepository;
  let databaseClock: DatabaseClock;
  let teamId: string;
  let otherTeamId: string;
  let creatorId: string;
  let projectId: string;

  beforeAll(() => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    const config: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: connectionString,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: 'local-test-login-token-pepper-change-me',
      trustedProxyHops: 0,
      agentServiceUrl: 'http://127.0.0.1:3002',
    };
    pool = new Pool({ connectionString, max: 8 });
    prisma = new PrismaService(config);
    conversations = new PrismaConversationRepository(prisma);
    messages = new PrismaMessageRepository(prisma);
    generationRequests = new PrismaStoryGenerationRequestRepository(prisma);
    databaseClock = new DatabaseClock(prisma);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
    );
    teamId = randomUUID();
    otherTeamId = randomUUID();
    creatorId = randomUUID();
    projectId = randomUUID();
    const otherCreatorId = randomUUID();
    await insertUser(creatorId, 'creator@example.com');
    await insertUser(otherCreatorId, 'other@example.com');
    await insertTeam(teamId, creatorId, '故事团队');
    await insertTeam(otherTeamId, otherCreatorId, '另一个团队');
    await insertMembership(teamId, creatorId, 'admin');
    await insertMembership(otherTeamId, otherCreatorId, 'admin');
    await pool.query(
      'INSERT INTO story_projects (id, tenant_id, space_id, created_by_user_id, owner_user_id, title, visibility, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)',
      [
        projectId,
        teamId,
        teamId,
        creatorId,
        creatorId,
        '故事项目',
        'team',
        'active',
        1,
        NOW,
      ],
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('persists conversations, immutable messages, and pending generation requests', async () => {
    const conversation = conversationSnapshot({ id: randomUUID() });
    await conversations.create(conversation);
    const message = messageSnapshot({
      id: randomUUID(),
      conversationId: conversation.id,
    });
    await messages.create(message);
    const generationRequest = generationRequestSnapshot({
      id: randomUUID(),
      conversationId: conversation.id,
      triggerMessageId: message.id,
    });
    await generationRequests.create(generationRequest);

    await expect(
      conversations.findById({
        tenantId: teamId,
        conversationId: conversation.id,
      }),
    ).resolves.toMatchObject({ title: '人物关系' });
    await expect(
      messages.listForConversation({
        tenantId: teamId,
        conversationId: conversation.id,
        page: { limit: 10, after: null },
      }),
    ).resolves.toMatchObject({
      items: [{ id: message.id, body: '请梳理人物关系' }],
    });
    await expect(
      generationRequests.findByTriggerMessageId({
        tenantId: teamId,
        triggerMessageId: message.id,
      }),
    ).resolves.toMatchObject({ id: generationRequest.id, status: 'pending' });
    await expect(databaseClock.now()).resolves.toBeInstanceOf(Date);
  });

  it('uses a stable keyset page for conversations', async () => {
    const older = conversationSnapshot({
      id: randomUUID(),
      title: '较早对话',
      createdAt: new Date('2026-08-10T03:30:01.000Z'),
      updatedAt: new Date('2026-08-10T03:30:01.000Z'),
    });
    const newer = conversationSnapshot({
      id: randomUUID(),
      title: '较新对话',
      createdAt: new Date('2026-08-10T03:30:02.000Z'),
      updatedAt: new Date('2026-08-10T03:30:02.000Z'),
    });
    await conversations.create(older);
    await conversations.create(newer);

    const first = await conversations.listForProject({
      tenantId: teamId,
      projectId,
      page: { limit: 1, after: null },
    });
    expect(first.items.map((item) => item.title)).toEqual(['较新对话']);
    expect(first.next).toMatchObject({ id: newer.id });
    const second = await conversations.listForProject({
      tenantId: teamId,
      projectId,
      page: { limit: 1, after: first.next },
    });
    expect(second.items.map((item) => item.title)).toEqual(['较早对话']);
    expect(second.next).toBeNull();
  });

  it('locks and updates a generation request state without losing result metadata', async () => {
    const conversation = conversationSnapshot({ id: randomUUID() });
    await conversations.create(conversation);
    const message = messageSnapshot({
      id: randomUUID(),
      conversationId: conversation.id,
    });
    await messages.create(message);
    const pending = generationRequestSnapshot({
      id: randomUUID(),
      conversationId: conversation.id,
      triggerMessageId: message.id,
    });
    await generationRequests.create(pending);

    const aggregate = StoryGenerationRequest.restore(pending);
    aggregate.startProcessing(NOW);
    aggregate.succeed(
      {
        agentMessageId: randomUUID(),
        artifactId: randomUUID(),
        artifactVersionId: randomUUID(),
      },
      new Date(NOW.getTime() + 1_000),
    );
    await generationRequests.update(aggregate.toSnapshot());

    await expect(
      generationRequests.findByIdLocked({
        tenantId: teamId,
        requestId: pending.id,
      }),
    ).resolves.toMatchObject({
      id: pending.id,
      status: 'succeeded',
      agentMessageId: expect.any(String),
      artifactId: expect.any(String),
      artifactVersionId: expect.any(String),
    });
  });

  it('rejects cross-tenant conversation, message, and generation references', async () => {
    const conversationId = randomUUID();
    await expect(
      pool.query(
        'INSERT INTO conversations (id, tenant_id, project_id, title, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)',
        [
          conversationId,
          otherTeamId,
          projectId,
          '跨租户对话',
          'active',
          1,
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const conversation = conversationSnapshot({ id: randomUUID() });
    await conversations.create(conversation);
    const messageId = randomUUID();
    await expect(
      pool.query(
        'INSERT INTO messages (id, tenant_id, conversation_id, author_type, author_user_id, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          messageId,
          otherTeamId,
          conversation.id,
          'agent',
          null,
          '越权消息',
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const message = messageSnapshot({
      id: randomUUID(),
      conversationId: conversation.id,
    });
    await messages.create(message);
    await expect(
      pool.query(
        'INSERT INTO story_generation_requests (id, tenant_id, conversation_id, trigger_message_id, idempotency_key, input_snapshot, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
        [
          randomUUID(),
          otherTeamId,
          conversation.id,
          message.id,
          'cross',
          '{}',
          'pending',
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const anotherConversation = conversationSnapshot({ id: randomUUID() });
    await conversations.create(anotherConversation);
    await expect(
      pool.query(
        'INSERT INTO story_generation_requests (id, tenant_id, conversation_id, trigger_message_id, idempotency_key, input_snapshot, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
        [
          randomUUID(),
          teamId,
          anotherConversation.id,
          message.id,
          'cross-conversation',
          '{}',
          'pending',
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  function conversationSnapshot(
    overrides: Partial<ConversationSnapshot> = {},
  ): ConversationSnapshot {
    return {
      id: randomUUID(),
      tenantId: teamId,
      projectId,
      title: '人物关系',
      status: 'active',
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  function messageSnapshot(
    overrides: Partial<MessageSnapshot> = {},
  ): MessageSnapshot {
    return {
      id: randomUUID(),
      tenantId: teamId,
      conversationId: 'conversation-id',
      authorType: 'user',
      authorUserId: creatorId,
      body: '请梳理人物关系',
      createdAt: NOW,
      ...overrides,
    };
  }

  function generationRequestSnapshot(
    overrides: Partial<StoryGenerationRequestSnapshot> = {},
  ): StoryGenerationRequestSnapshot {
    return {
      id: randomUUID(),
      tenantId: teamId,
      conversationId: 'conversation-id',
      triggerMessageId: 'message-id',
      idempotencyKey: 'message-key',
      inputSnapshot: { body: '请梳理人物关系' },
      status: 'pending',
      failureCode: null,
      processingStartedAt: null,
      completedAt: null,
      agentMessageId: null,
      artifactId: null,
      artifactVersionId: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    };
  }

  async function insertUser(id: string, email: string): Promise<void> {
    await pool.query(
      'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, $3, $3)',
      [id, email, NOW],
    );
  }

  async function insertTeam(
    id: string,
    createdByUserId: string,
    name: string,
  ): Promise<void> {
    await pool.query(
      'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, name, createdByUserId, NOW],
    );
    await pool.query(
      'INSERT INTO spaces (id, kind, owner_team_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)',
      [id, 'team', id, NOW],
    );
  }

  async function insertMembership(
    tenantId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    await pool.query(
      'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), tenantId, userId, role, NOW],
    );
  }
});

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
