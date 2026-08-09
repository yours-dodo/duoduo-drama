import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaProjectCollaboratorRepository } from './prisma-project-collaborator.repository.js';
import { PrismaStoryProjectRepository } from './prisma-story-project.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-10T02:00:00.000Z');

describe.skipIf(!databaseUrl)('story project PostgreSQL boundary', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let projects: PrismaStoryProjectRepository;
  let collaborators: PrismaProjectCollaboratorRepository;
  let databaseClock: DatabaseClock;
  let teamId: string;
  let otherTeamId: string;
  let creatorId: string;
  let memberId: string;
  let otherMemberId: string;

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
    };
    pool = new Pool({ connectionString, max: 8 });
    prisma = new PrismaService(config);
    projects = new PrismaStoryProjectRepository(prisma);
    collaborators = new PrismaProjectCollaboratorRepository(prisma);
    databaseClock = new DatabaseClock(prisma);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "teams", "identity_security_events", "sessions", "email_login_challenges", "users"',
    );
    teamId = randomUUID();
    otherTeamId = randomUUID();
    creatorId = randomUUID();
    memberId = randomUUID();
    otherMemberId = randomUUID();
    await insertUser(creatorId, 'creator@example.com');
    await insertUser(memberId, 'member@example.com');
    await insertUser(otherMemberId, 'other@example.com');
    await insertTeam(teamId, creatorId, '故事团队');
    await insertTeam(otherTeamId, otherMemberId, '另一个团队');
    await insertMembership(teamId, creatorId, 'admin');
    await insertMembership(teamId, memberId, 'member');
    await insertMembership(otherTeamId, otherMemberId, 'admin');
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('lists team projects and the member own private project without cross-tenant leakage', async () => {
    const teamProject = project({ id: randomUUID(), title: '团队项目' });
    const ownPrivate = project({
      id: randomUUID(),
      title: '我的私人项目',
      createdByUserId: memberId,
      visibility: 'private',
    });
    const otherPrivate = project({
      id: randomUUID(),
      title: '管理员私人项目',
      visibility: 'private',
    });
    await projects.create(teamProject);
    await projects.create(ownPrivate);
    await projects.create(otherPrivate);
    await collaborators.create({
      id: randomUUID(),
      tenantId: teamId,
      projectId: teamProject.id,
      userId: memberId,
      createdAt: NOW,
    });

    const memberProjects = await projects.listVisible({
      tenantId: teamId,
      actorUserId: memberId,
      actorRole: 'member',
      page: { limit: 10, after: null },
    });
    expect(memberProjects.items).toHaveLength(2);
    expect(new Set(memberProjects.items.map((item) => item.title))).toEqual(
      new Set(['我的私人项目', '团队项目']),
    );
    expect(
      memberProjects.items.find((item) => item.id === teamProject.id)
        ?.collaborator,
    ).toBe(true);

    const adminProjects = await projects.listVisible({
      tenantId: teamId,
      actorUserId: creatorId,
      actorRole: 'admin',
      page: { limit: 10, after: null },
    });
    expect(adminProjects.items).toHaveLength(3);
    await expect(
      projects.findById({ tenantId: otherTeamId, projectId: teamProject.id }),
    ).resolves.toBeNull();
  });

  it('rejects cross-tenant project creators and collaborator references', async () => {
    const projectId = randomUUID();
    await expect(
      pool.query(
        'INSERT INTO story_projects (id, tenant_id, created_by_user_id, title, visibility, status, revision, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
        [
          projectId,
          teamId,
          otherMemberId,
          '越权项目',
          'team',
          'active',
          1,
          NOW,
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const projectRow = project({ id: projectId });
    await projects.create(projectRow);
    await expect(
      pool.query(
        'INSERT INTO project_collaborators (id, tenant_id, project_id, user_id, created_at) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), otherTeamId, projectRow.id, otherMemberId, NOW],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        'INSERT INTO project_collaborators (id, tenant_id, project_id, user_id, created_at) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), teamId, projectRow.id, otherMemberId, NOW],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('uses the database clock for repository-facing timestamps', async () => {
    const now = await databaseClock.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThan(0);
  });

  function project(
    overrides: Partial<StoryProjectSnapshot> = {},
  ): StoryProjectSnapshot {
    return {
      id: randomUUID(),
      tenantId: teamId,
      createdByUserId: creatorId,
      title: '故事项目',
      visibility: 'team',
      status: 'active',
      revision: 1,
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
