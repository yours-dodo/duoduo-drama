import { createHash, randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository.js';
import {
  CreateTeam,
  IdempotencyConflictError,
} from '../application/create-team.js';
import { ListMyTeams } from '../application/list-my-teams.js';
import { PrismaIdempotencyRepository } from './prisma-idempotency.repository.js';
import { PrismaTeamMembershipRepository } from './prisma-team-membership.repository.js';
import { PrismaTeamRepository } from './prisma-team.repository.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)('Prisma tenancy boundary', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let transactions: TransactionRunner;
  let teams: PrismaTeamRepository;
  let memberships: PrismaTeamMembershipRepository;
  let idempotency: PrismaIdempotencyRepository;
  let audit: PrismaAuditRepository;
  let databaseClock: DatabaseClock;
  let userId: string;

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
    transactions = new TransactionRunner(prisma);
    teams = new PrismaTeamRepository(prisma);
    memberships = new PrismaTeamMembershipRepository(prisma);
    idempotency = new PrismaIdempotencyRepository(prisma);
    audit = new PrismaAuditRepository(prisma);
    databaseClock = new DatabaseClock(prisma);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "teams", "identity_security_events", "sessions", "email_login_challenges", "users"',
    );
    userId = randomUUID();
    await insertUser(pool, userId, 'tenant.creator@example.com');
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('creates one tenant, administrator membership, idempotency result, and audit record', async () => {
    const result = await buildCreateTeam().execute({
      actorUserId: userId,
      name: '多多编剧组',
      idempotencyKey: 'create-team',
      requestId: 'request-id',
    });

    expect(result.team).toMatchObject({ name: '多多编剧组', role: 'admin' });
    await expect(countRows(pool, 'teams')).resolves.toBe(1);
    await expect(countRows(pool, 'team_memberships')).resolves.toBe(1);
    await expect(countRows(pool, 'idempotency_records')).resolves.toBe(1);
    await expect(countRows(pool, 'audit_records')).resolves.toBe(1);
    await expect(
      memberships.findActive({ tenantId: result.team.id, userId }),
    ).resolves.toMatchObject({ role: 'admin' });
  });

  it('returns one team under concurrent replay of the same idempotency key', async () => {
    const attempts = Array.from({ length: 6 }, () =>
      buildCreateTeam().execute({
        actorUserId: userId,
        name: '并发团队',
        idempotencyKey: 'same-key',
        requestId: randomUUID(),
      }),
    );

    const results = await Promise.all(attempts);

    expect(new Set(results.map((result) => result.team.id)).size).toBe(1);
    await expect(countRows(pool, 'teams')).resolves.toBe(1);
    await expect(countRows(pool, 'team_memberships')).resolves.toBe(1);
    await expect(countRows(pool, 'audit_records')).resolves.toBe(1);
  });

  it('lists multiple active teams for one global user', async () => {
    await buildCreateTeam().execute({
      actorUserId: userId,
      name: '团队一',
      idempotencyKey: 'team-one',
      requestId: 'request-one',
    });
    await buildCreateTeam().execute({
      actorUserId: userId,
      name: '团队二',
      idempotencyKey: 'team-two',
      requestId: 'request-two',
    });

    const result = await new ListMyTeams(teams).execute({ userId });

    expect(result.teams.map((team) => team.name)).toEqual(['团队一', '团队二']);
    expect(result.teams.every((team) => team.role === 'admin')).toBe(true);
  });

  it('rejects an idempotency key reused with another team name', async () => {
    await buildCreateTeam().execute({
      actorUserId: userId,
      name: '原团队',
      idempotencyKey: 'reused-key',
      requestId: 'original-request',
    });

    await expect(
      buildCreateTeam().execute({
        actorUserId: userId,
        name: '另一个团队',
        idempotencyKey: 'reused-key',
        requestId: 'conflict-request',
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await expect(countRows(pool, 'teams')).resolves.toBe(1);
  });

  it('rolls back all tenant data when the audit write fails', async () => {
    const failingAudit: AuditRepository = {
      record: async () => {
        throw new Error('audit unavailable');
      },
    };

    await expect(
      buildCreateTeam(failingAudit).execute({
        actorUserId: userId,
        name: '回滚团队',
        idempotencyKey: 'rollback-key',
        requestId: 'rollback-request',
      }),
    ).rejects.toThrow('audit unavailable');
    await expect(countRows(pool, 'teams')).resolves.toBe(0);
    await expect(countRows(pool, 'team_memberships')).resolves.toBe(0);
    await expect(countRows(pool, 'idempotency_records')).resolves.toBe(0);
  });

  it('rejects invalid roles and memberships for a missing tenant', async () => {
    await expect(
      insertMembership(pool, {
        tenantId: randomUUID(),
        userId,
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: '23503' });

    const team = await buildCreateTeam().execute({
      actorUserId: userId,
      name: '约束团队',
      idempotencyKey: 'constraint-key',
      requestId: 'constraint-request',
    });
    const anotherUserId = randomUUID();
    await insertUser(pool, anotherUserId, 'other@example.com');
    await expect(
      insertMembership(pool, {
        tenantId: team.team.id,
        userId: anotherUserId,
        role: 'owner',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  function buildCreateTeam(
    auditRepository: AuditRepository = audit,
  ): CreateTeam {
    return new CreateTeam(
      teams,
      memberships,
      idempotency,
      auditRepository,
      transactions,
      databaseClock,
      {
        hash: (value) => createHash('sha256').update(value).digest('hex'),
      },
      { create: () => randomUUID() },
    );
  }
});

async function insertUser(
  pool: Pool,
  id: string,
  email: string,
): Promise<void> {
  await pool.query(
    'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp())',
    [id, email],
  );
}

async function insertMembership(
  pool: Pool,
  input: { tenantId: string; userId: string; role: string },
): Promise<void> {
  await pool.query(
    'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, clock_timestamp())',
    [randomUUID(), input.tenantId, input.userId, input.role],
  );
}

async function countRows(pool: Pool, table: string): Promise<number> {
  if (
    ![
      'teams',
      'team_memberships',
      'idempotency_records',
      'audit_records',
    ].includes(table)
  ) {
    throw new Error('Unexpected test table');
  }
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('SERVER_TEST_POSTGRES_URL is required');
  }
  return value;
}
