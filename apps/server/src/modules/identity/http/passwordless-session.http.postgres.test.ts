import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../../../config/server-config.js';
import { createTestApp } from '../../../test/create-test-app.js';
import { readServerTestDatabaseUrl } from '../../../test/postgres-test-context.js';
import { LocalEmailDelivery } from '../infrastructure/local-email-delivery.js';

const databaseUrl = readServerTestDatabaseUrl();

describe.skipIf(!databaseUrl)(
  'passwordless session HTTP PostgreSQL flow',
  () => {
    let app: INestApplication;
    let pool: Pool;

    beforeAll(async () => {
      const connectionString = requireDatabaseUrl(databaseUrl);
      pool = new Pool({ connectionString });
      await pool.query(
        'TRUNCATE TABLE "story_artifact_versions", "story_artifacts", "story_import_jobs", "assets", "story_generation_requests", "messages", "conversations", "project_collaborators", "story_projects", "team_invitations", "audit_records", "idempotency_records", "team_memberships", "spaces", "teams", "identity_security_events", "sessions", "email_login_challenges", "users" CASCADE',
      );
      const serverConfig: ServerConfig = {
        environment: 'test',
        port: 3001,
        cookieSecret: 'local-test-cookie-secret-change-me',
        trustedOrigins: ['http://localhost:3000'],
        databaseUrl: connectionString,
        publicWebUrl: 'http://localhost:3000',
        loginTokenPepper: 'local-test-login-token-pepper-change-me',
        trustedProxyHops: 1,
      };
      app = await createTestApp({ serverConfig });
    });

    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    it('logs in a new email, exposes the current user, rejects replay, and logs out', async () => {
      const browser = request.agent(app.getHttpServer());

      await browser
        .post('/v1/auth/email-login-requests')
        .send({ email: 'new.creator@example.com' })
        .expect(202);
      const delivered = app.get(LocalEmailDelivery).readLatestForTest();
      if (delivered === null) {
        throw new Error('Expected the local email adapter to receive a token');
      }

      await browser
        .post('/v1/auth/email-login-verifications')
        .send({ token: delivered.token })
        .expect(200);
      const me = await browser.get('/v1/me').expect(200);
      expect(me.body).toMatchObject({
        user: { email: 'new.creator@example.com' },
      });

      await request(app.getHttpServer())
        .post('/v1/auth/email-login-verifications')
        .send({ token: delivered.token })
        .expect(401);

      await browser
        .delete('/v1/auth/session')
        .set('Origin', 'http://localhost:3000')
        .expect(204);
      await browser.get('/v1/me').expect(401);
    });
  },
);

function requireDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('SERVER_TEST_POSTGRES_URL is required');
  }
  return value;
}
