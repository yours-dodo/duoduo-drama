import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { LastTeamAdministratorError } from '../../../domain/tenancy/team-membership.js';
import type { ServerConfig } from '../../../config/server-config.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { PrismaAuditRepository } from '../../audit/infrastructure/prisma-audit.repository.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { AcceptTeamInvitation } from '../application/accept-team-invitation.js';
import { RemoveTeamMember } from '../application/remove-team-member.js';
import { TeamInvitationNotFoundError } from '../application/tenancy-errors.js';
import { PrismaTeamInvitationRepository } from './prisma-team-invitation.repository.js';
import { PrismaTeamMembershipRepository } from './prisma-team-membership.repository.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)('Prisma team membership lifecycle', () => {
  let pool: Pool;
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let tenantId: string;
  let adminId: string;
  let memberId: string;

  beforeAll(() => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    pool = new Pool({ connectionString, max: 8 });
    prismaA = new PrismaService(configFor(connectionString));
    prismaB = new PrismaService(configFor(connectionString));
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "teams", "identity_security_events", "sessions", "email_login_challenges", "users"',
    );
    tenantId = randomUUID();
    adminId = randomUUID();
    memberId = randomUUID();
    await insertUser(pool, adminId, 'admin@example.com');
    await insertUser(pool, memberId, 'member@example.com');
    await insertTeam(pool, tenantId, adminId);
    await insertMembership(pool, tenantId, adminId, 'admin');
  });

  afterAll(async () => {
    await Promise.all([prismaA.onModuleDestroy(), prismaB.onModuleDestroy()]);
    await pool.end();
  });

  it('allows only one server instance to accept an invitation token', async () => {
    const tokenHash = 'e'.repeat(64);
    await insertInvitation(pool, {
      tenantId,
      invitedByUserId: adminId,
      tokenHash,
    });

    const attempts = await Promise.allSettled([
      acceptUseCase(prismaA, tokenHash).execute(acceptInput()),
      acceptUseCase(prismaB, tokenHash).execute(acceptInput()),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: new TeamInvitationNotFoundError(),
    });
    await expect(activeMembershipCount(pool, tenantId, memberId)).resolves.toBe(
      1,
    );
    await expect(auditActionCount(pool, 'TEAM_MEMBER_JOINED')).resolves.toBe(1);
  });

  it('serializes concurrent removals so one active administrator remains', async () => {
    const secondAdminId = randomUUID();
    await insertUser(pool, secondAdminId, 'second.admin@example.com');
    const firstMembershipId = await membershipIdFor(pool, tenantId, adminId);
    const secondMembershipId = await insertMembership(
      pool,
      tenantId,
      secondAdminId,
      'admin',
    );

    const attempts = await Promise.allSettled([
      removeUseCase(prismaA).execute({
        tenantId,
        actorUserId: adminId,
        membershipId: firstMembershipId,
        requestId: randomUUID(),
      }),
      removeUseCase(prismaB).execute({
        tenantId,
        actorUserId: secondAdminId,
        membershipId: secondMembershipId,
        requestId: randomUUID(),
      }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: new LastTeamAdministratorError(),
    });
    await expect(activeAdministratorCount(pool, tenantId)).resolves.toBe(1);
  });

  it('rolls back invitation acceptance when its audit write fails', async () => {
    const tokenHash = 'f'.repeat(64);
    await insertInvitation(pool, {
      tenantId,
      invitedByUserId: adminId,
      tokenHash,
    });
    const failingAudit: AuditRepository = {
      record: async () => {
        throw new Error('audit unavailable');
      },
    };

    await expect(
      acceptUseCase(prismaA, tokenHash, failingAudit).execute(acceptInput()),
    ).rejects.toThrow('audit unavailable');
    await expect(activeMembershipCount(pool, tenantId, memberId)).resolves.toBe(
      0,
    );
    await expect(acceptedInvitationCount(pool, tokenHash)).resolves.toBe(0);
  });

  it('rejects cross-tenant invitation senders and audit actors', async () => {
    const outsiderId = randomUUID();
    await insertUser(pool, outsiderId, 'outsider@example.com');

    await expect(
      insertInvitation(pool, {
        tenantId,
        invitedByUserId: outsiderId,
        tokenHash: '1'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        'INSERT INTO audit_records (id, tenant_id, actor_user_id, action, target_type, target_id, request_id, occurred_at) VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())',
        [
          randomUUID(),
          tenantId,
          outsiderId,
          'TEAM_MEMBER_REMOVED',
          'TEAM_MEMBERSHIP',
          randomUUID(),
          randomUUID(),
        ],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  function acceptInput() {
    return {
      actorUserId: memberId,
      actorEmail: 'member@example.com',
      token: 'raw-token',
      requestId: randomUUID(),
    };
  }
});

function acceptUseCase(
  prisma: PrismaService,
  tokenHash: string,
  audit: AuditRepository = new PrismaAuditRepository(prisma),
) {
  return new AcceptTeamInvitation(
    new PrismaTeamInvitationRepository(prisma),
    new PrismaTeamMembershipRepository(prisma),
    audit,
    new TransactionRunner(prisma),
    new DatabaseClock(prisma),
    { hashToken: () => tokenHash },
    { create: () => randomUUID() },
  );
}

function removeUseCase(prisma: PrismaService) {
  return new RemoveTeamMember(
    new PrismaTeamMembershipRepository(prisma),
    new PrismaAuditRepository(prisma),
    new TransactionRunner(prisma),
    new DatabaseClock(prisma),
    { create: () => randomUUID() },
  );
}

function configFor(connectionString: string): ServerConfig {
  return {
    environment: 'test',
    port: 3001,
    cookieSecret: 'local-test-cookie-secret-change-me',
    trustedOrigins: ['http://localhost:3000'],
    databaseUrl: connectionString,
    publicWebUrl: 'http://localhost:3000',
    loginTokenPepper: 'local-test-login-token-pepper-change-me',
    trustedProxyHops: 0,
  };
}

async function insertUser(pool: Pool, id: string, email: string) {
  await pool.query(
    'INSERT INTO users (id, email, created_at, updated_at) VALUES ($1, $2, clock_timestamp(), clock_timestamp())',
    [id, email],
  );
}

async function insertTeam(pool: Pool, id: string, creatorId: string) {
  await pool.query(
    'INSERT INTO teams (id, name, created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, clock_timestamp(), clock_timestamp())',
    [id, 'Test team', creatorId],
  );
}

async function insertMembership(
  pool: Pool,
  tenantId: string,
  userId: string,
  role: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO team_memberships (id, tenant_id, user_id, role, joined_at) VALUES ($1, $2, $3, $4, clock_timestamp())',
    [id, tenantId, userId, role],
  );
  return id;
}

async function insertInvitation(
  pool: Pool,
  input: { tenantId: string; invitedByUserId: string; tokenHash: string },
) {
  await pool.query(
    "INSERT INTO team_invitations (id, tenant_id, email, invited_by_user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp() + INTERVAL '7 days')",
    [
      randomUUID(),
      input.tenantId,
      'member@example.com',
      input.invitedByUserId,
      input.tokenHash,
    ],
  );
}

async function membershipIdFor(pool: Pool, tenantId: string, userId: string) {
  const result = await pool.query<{ id: string }>(
    'SELECT id FROM team_memberships WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, userId],
  );
  return result.rows[0]?.id ?? '';
}

async function activeMembershipCount(
  pool: Pool,
  tenantId: string,
  userId: string,
) {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM team_memberships WHERE tenant_id = $1 AND user_id = $2 AND removed_at IS NULL',
    [tenantId, userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function activeAdministratorCount(pool: Pool, tenantId: string) {
  const result = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM team_memberships WHERE tenant_id = $1 AND role = 'admin' AND removed_at IS NULL",
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function auditActionCount(pool: Pool, action: string) {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM audit_records WHERE action = $1',
    [action],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function acceptedInvitationCount(pool: Pool, tokenHash: string) {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM team_invitations WHERE token_hash = $1 AND accepted_at IS NOT NULL',
    [tokenHash],
  );
  return Number(result.rows[0]?.count ?? 0);
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('SERVER_TEST_POSTGRES_URL is required');
  return value;
}
