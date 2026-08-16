import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import { PrismaService } from '../../../platform/database/prisma.service.js';
import { TransactionRunner } from '../../../platform/database/transaction-runner.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { Logout } from '../application/logout.js';
import {
  InvalidLoginChallengeError,
  VerifyEmailLogin,
} from '../application/verify-email-login.js';
import type { IdentityTokenSecurity } from '../ports/identity-token-security.js';
import { NodeLoginChallengeSecurity } from './node-login-challenge-security.js';
import { PrismaIdentitySecurityEventRepository } from './prisma-identity-security-event.repository.js';
import { PrismaLoginChallengeRepository } from './prisma-login-challenge.repository.js';
import { PrismaSessionRepository } from './prisma-session.repository.js';
import { PrismaSpaceRepository } from '../../spaces/infrastructure/prisma-space.repository.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

const databaseUrl = readServerTestDatabaseUrl();
const PEPPER = 'local-test-login-token-pepper-change-me';

describe.skipIf(!databaseUrl)('passwordless session persistence', () => {
  let pool: Pool;
  let prisma: PrismaService;
  let transactions: TransactionRunner;
  let challenges: PrismaLoginChallengeRepository;
  let sessions: PrismaSessionRepository;
  let spaces: PrismaSpaceRepository;
  let users: PrismaUserRepository;
  let databaseClock: DatabaseClock;
  let events: PrismaIdentitySecurityEventRepository;
  let security: NodeLoginChallengeSecurity;

  beforeAll(() => {
    const connectionString = requireDatabaseUrl(databaseUrl);
    const config: ServerConfig = {
      environment: 'test',
      port: 3001,
      cookieSecret: 'local-test-cookie-secret-change-me',
      trustedOrigins: ['http://localhost:3000'],
      databaseUrl: connectionString,
      publicWebUrl: 'http://localhost:3000',
      loginTokenPepper: PEPPER,
      trustedProxyHops: 0,
    };

    pool = new Pool({ connectionString, max: 8 });
    prisma = new PrismaService(config);
    transactions = new TransactionRunner(prisma);
    challenges = new PrismaLoginChallengeRepository(prisma, transactions);
    sessions = new PrismaSessionRepository(prisma);
    spaces = new PrismaSpaceRepository(prisma);
    databaseClock = new DatabaseClock(prisma);
    users = new PrismaUserRepository(prisma, spaces, databaseClock);
    events = new PrismaIdentitySecurityEventRepository(prisma);
    security = new NodeLoginChallengeSecurity(PEPPER);
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

  it('creates a new user and an active session without persisting raw tokens', async () => {
    const loginToken = 'raw-login-token-that-must-not-reach-postgres';
    await insertChallenge(pool, security.hashToken(loginToken));
    const verify = buildVerify();

    const result = await verify.execute({
      token: loginToken,
      requestId: 'verification-request',
    });

    const persisted = await pool.query(
      'SELECT u.email, s.token_hash, c.consumed_at FROM users u JOIN sessions s ON s.user_id = u.id JOIN email_login_challenges c ON c.email = u.email',
    );
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({ email: 'creator@example.com' });
    expect(JSON.stringify(persisted.rows)).not.toContain(loginToken);
    expect(JSON.stringify(persisted.rows)).not.toContain(result.sessionToken);
    expect(persisted.rows[0]?.consumed_at).not.toBeNull();
    await users.findOrCreateByEmail({
      email: 'creator@example.com',
      newUserId: randomUUID(),
    });
    await expect(countRows(pool, 'spaces')).resolves.toBe(1);
    await expect(
      sessions.findActiveByTokenHash(
        security.hashSessionToken(result.sessionToken),
      ),
    ).resolves.toMatchObject({
      userId: result.user.id,
      email: 'creator@example.com',
    });
  });

  it('allows only one concurrent verification of the same challenge', async () => {
    const loginToken = 'single-use-login-token';
    await insertChallenge(pool, security.hashToken(loginToken));

    const results = await Promise.allSettled([
      buildVerify().execute({ token: loginToken, requestId: 'request-one' }),
      buildVerify().execute({ token: loginToken, requestId: 'request-two' }),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({
      reason: new InvalidLoginChallengeError(),
    });
    await expect(countRows(pool, 'users')).resolves.toBe(1);
    await expect(countRows(pool, 'spaces')).resolves.toBe(1);
    await expect(countRows(pool, 'sessions')).resolves.toBe(1);
  });

  it('rolls back challenge consumption when session persistence fails', async () => {
    const firstToken = 'first-transaction-login-token';
    const secondToken = 'second-transaction-login-token';
    await insertChallenge(pool, security.hashToken(firstToken));
    await insertChallenge(pool, security.hashToken(secondToken));
    const collidingSecurity: IdentityTokenSecurity = {
      issueToken: () => 'unused-login-token',
      hashToken: (token) => security.hashToken(token),
      digestSource: (source) => security.digestSource(source),
      issueSessionToken: () => 'fixed-session-token',
      hashLoginToken: (token) => security.hashLoginToken(token),
      hashSessionToken: () => 'f'.repeat(64),
    };

    await buildVerify(collidingSecurity).execute({
      token: firstToken,
      requestId: 'first-request',
    });
    await expect(
      buildVerify(collidingSecurity).execute({
        token: secondToken,
        requestId: 'second-request',
      }),
    ).rejects.toThrow();

    const secondChallenge = await pool.query<{ consumed_at: Date | null }>(
      'SELECT consumed_at FROM email_login_challenges WHERE token_hash = $1',
      [security.hashToken(secondToken)],
    );
    expect(secondChallenge.rows[0]?.consumed_at).toBeNull();
    await expect(countRows(pool, 'sessions')).resolves.toBe(1);
  });

  it('rejects expired and locked challenges without creating sessions', async () => {
    const expiredToken = 'expired-login-token';
    const lockedToken = 'locked-login-token';
    await insertChallenge(pool, security.hashToken(expiredToken), {
      expired: true,
    });
    await insertChallenge(pool, security.hashToken(lockedToken), {
      attemptCount: 5,
    });

    await expect(
      buildVerify().execute({ token: expiredToken, requestId: 'expired' }),
    ).rejects.toBeInstanceOf(InvalidLoginChallengeError);
    await expect(
      buildVerify().execute({ token: lockedToken, requestId: 'locked' }),
    ).rejects.toBeInstanceOf(InvalidLoginChallengeError);
    await expect(countRows(pool, 'sessions')).resolves.toBe(0);
  });

  it('revokes a session immediately and records one idempotent security event', async () => {
    const loginToken = 'logout-login-token';
    await insertChallenge(pool, security.hashToken(loginToken));
    const verified = await buildVerify().execute({
      token: loginToken,
      requestId: 'verification-request',
    });
    const active = await sessions.findActiveByTokenHash(
      security.hashSessionToken(verified.sessionToken),
    );
    if (active === null) {
      throw new Error('Expected an active test session');
    }
    const logout = new Logout(sessions, events, transactions, {
      create: () => randomUUID(),
    });

    await logout.execute({
      sessionId: active.id,
      requestId: 'logout-request',
    });
    await logout.execute({
      sessionId: active.id,
      requestId: 'logout-retry',
    });

    await expect(
      sessions.findActiveByTokenHash(
        security.hashSessionToken(verified.sessionToken),
      ),
    ).resolves.toBeNull();
    await expect(countRows(pool, 'identity_security_events')).resolves.toBe(1);
  });

  function buildVerify(
    tokenSecurity: IdentityTokenSecurity = security,
  ): VerifyEmailLogin {
    return new VerifyEmailLogin(
      challenges,
      users,
      sessions,
      events,
      tokenSecurity,
      transactions,
      { create: () => randomUUID() },
    );
  }
});

async function insertChallenge(
  pool: Pool,
  tokenHash: string,
  options: { expired?: boolean; attemptCount?: number } = {},
): Promise<void> {
  await pool.query(
    `INSERT INTO email_login_challenges
      (id, email, token_hash, source_digest, expires_at, attempt_count, created_at)
     VALUES
      ($1, 'creator@example.com', $2, $3,
       CASE WHEN $4 THEN clock_timestamp() - INTERVAL '1 minute' ELSE clock_timestamp() + INTERVAL '10 minutes' END,
       $5,
       CASE WHEN $4 THEN clock_timestamp() - INTERVAL '2 minutes' ELSE clock_timestamp() - INTERVAL '1 minute' END)`,
    [
      randomUUID(),
      tokenHash,
      'c'.repeat(64),
      options.expired ?? false,
      options.attemptCount ?? 0,
    ],
  );
}

async function countRows(pool: Pool, table: string): Promise<number> {
  if (
    !['users', 'spaces', 'sessions', 'identity_security_events'].includes(table)
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
