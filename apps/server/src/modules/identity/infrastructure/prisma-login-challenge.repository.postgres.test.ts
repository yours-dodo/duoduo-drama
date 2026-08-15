import { randomUUID } from 'node:crypto';

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';

import type { ServerConfig } from '../../../config/server-config.js';
import { EmailAddress } from '../../../domain/identity/email-address.js';
import { LoginChallenge } from '../../../domain/identity/login-challenge.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { RequestEmailLogin } from '../application/request-email-login.js';
import { PrismaLoginChallengeRepository } from './prisma-login-challenge.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const NOW = new Date('2026-08-09T10:00:00.000Z');

describe.skipIf(!databaseUrl)('PrismaLoginChallengeRepository', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let repository: PrismaLoginChallengeRepository;

  beforeAll(() => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    const serverConfig: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: connectionString,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: 'local-test-login-token-pepper-change-me',
      trustedProxyHops: 0,
    };

    pool = new Pool({ connectionString, max: 4 });
    prisma = new PrismaService(serverConfig);
    repository = new PrismaLoginChallengeRepository(
      prisma,
      new TransactionRunner(prisma),
    );
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await pool.end();
  });

  it('enforces normalized user email uniqueness in PostgreSQL', async () => {
    await insertUser(pool, 'writer@example.com');

    await expect(insertUser(pool, 'writer@example.com')).rejects.toMatchObject({
      code: '23505',
    });
    await expect(insertUser(pool, 'Writer@Example.com')).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('stores only the protected token hash', async () => {
    const rawToken = 'raw-login-token-that-must-not-reach-postgres';
    const tokenHash = 'd'.repeat(64);
    const deliver = vi.fn().mockResolvedValue(undefined);
    const requestLogin = new RequestEmailLogin(
      repository,
      { deliver },
      {
        issueToken: () => rawToken,
        hashToken: () => tokenHash,
        digestSource: () => 'c'.repeat(64),
      },
      { now: () => NOW },
      { create: () => randomUUID() },
    );
    await requestLogin.execute({
      email: 'protected@example.com',
      sourceAddress: '203.0.113.9',
    });

    const result = await pool.query(
      'SELECT * FROM "email_login_challenges" WHERE "token_hash" = $1',
      [tokenHash],
    );
    expect(result.rows).toHaveLength(1);
    expect(JSON.stringify(result.rows)).not.toContain(rawToken);
    expect(Object.keys(result.rows[0] ?? {})).not.toContain('token');
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ token: rawToken }),
    );
  });

  it('returns only an unconsumed, unexpired challenge by token hash', async () => {
    const active = buildChallenge({
      email: 'active@example.com',
      tokenHash: 'a'.repeat(64),
      issuedAt: NOW,
    });
    const expired = buildChallenge({
      email: 'expired@example.com',
      tokenHash: 'b'.repeat(64),
      issuedAt: new Date('2026-08-09T09:40:00.000Z'),
    });
    await repository.createIfAllowed(buildCreateRequest(active));
    await repository.createIfAllowed(buildCreateRequest(expired));
    const clockResult = await pool.query<{ database_now: Date }>(
      'SELECT clock_timestamp() AS database_now',
    );
    const databaseNow = new Date(clockResult.rows[0]?.database_now ?? NOW);
    await pool.query(
      'UPDATE "email_login_challenges" SET "created_at" = $1, "expires_at" = $2 WHERE "id" = $3',
      [
        new Date(databaseNow.getTime() - 20 * 60 * 1_000),
        new Date(databaseNow.getTime() - 10 * 60 * 1_000),
        expired.id,
      ],
    );

    await expect(
      repository.findActiveByTokenHash('a'.repeat(64), databaseNow),
    ).resolves.toMatchObject({ id: active.id, email: 'active@example.com' });
    await expect(
      repository.findActiveByTokenHash('b'.repeat(64), databaseNow),
    ).resolves.toBeNull();
  });

  it('atomically limits concurrent requests for the same email', async () => {
    const attempts = Array.from({ length: 6 }, (_, index) =>
      repository.createIfAllowed(
        buildCreateRequest(
          buildChallenge({
            email: 'limited@example.com',
            tokenHash: index.toString(16).padStart(64, '0'),
            issuedAt: NOW,
          }),
        ),
      ),
    );

    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.created)).toHaveLength(5);
    await expect(countChallenges(pool)).resolves.toBe(5);
  });

  it('atomically limits concurrent requests from the same source digest', async () => {
    const attempts = Array.from({ length: 21 }, (_, index) =>
      repository.createIfAllowed(
        buildCreateRequest(
          buildChallenge({
            email: `writer-${index}@example.com`,
            tokenHash: (index + 100).toString(16).padStart(64, '0'),
            issuedAt: NOW,
          }),
        ),
      ),
    );

    const results = await Promise.all(attempts);

    expect(results.filter((result) => result.created)).toHaveLength(20);
    await expect(countChallenges(pool)).resolves.toBe(20);
  });
});

function buildChallenge(input: {
  email: string;
  tokenHash: string;
  issuedAt: Date;
}) {
  return LoginChallenge.issue({
    id: randomUUID(),
    email: EmailAddress.parse(input.email),
    tokenHash: input.tokenHash,
    sourceDigest: 'c'.repeat(64),
    issuedAt: input.issuedAt,
  }).toSnapshot();
}

function buildCreateRequest(challenge: ReturnType<typeof buildChallenge>) {
  return {
    challenge,
    limits: {
      email: { maximum: 5, windowMs: 15 * 60 * 1_000 },
      source: { maximum: 20, windowMs: 15 * 60 * 1_000 },
    },
  };
}

async function insertUser(pool: Pool, email: string): Promise<void> {
  await pool.query(
    'INSERT INTO "users" ("id", "email", "created_at", "updated_at") VALUES ($1, $2, NOW(), NOW())',
    [randomUUID(), email],
  );
}

async function countChallenges(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM "email_login_challenges"',
  );
  return Number(result.rows[0]?.count ?? 0);
}

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('SERVER_TEST_POSTGRES_URL is required');
  }
  return value;
}
