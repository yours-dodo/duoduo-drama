import { Inject, Injectable } from '@nestjs/common';

import type { SessionSnapshot } from '../../../domain/identity/session.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  AuthenticatedSessionSnapshot,
  RevokedSessionSnapshot,
  SessionRepository,
} from '../ports/session-repository.js';

interface ActiveSessionRow {
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
}

interface RevokedSessionRow {
  id: string;
  userId: string;
  revokedAt: Date;
}

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(session: SessionSnapshot): Promise<SessionSnapshot> {
    return this.database.withClient((client) =>
      client.session.create({ data: session }),
    );
  }

  findActiveByTokenHash(
    tokenHash: string,
  ): Promise<AuthenticatedSessionSnapshot | null> {
    return this.database.withClient(async (client) => {
      const [session] = await client.$queryRaw<ActiveSessionRow[]>`
        SELECT
          session.id,
          session.user_id AS "userId",
          identity_user.email,
          session.expires_at AS "expiresAt"
        FROM sessions AS session
        INNER JOIN users AS identity_user ON identity_user.id = session.user_id
        WHERE session.token_hash = ${tokenHash}
          AND session.revoked_at IS NULL
          AND session.expires_at > clock_timestamp()
        LIMIT 1
      `;

      return session ?? null;
    });
  }

  revoke(sessionId: string): Promise<RevokedSessionSnapshot | null> {
    return this.database.withClient(async (client) => {
      const [session] = await client.$queryRaw<RevokedSessionRow[]>`
        UPDATE sessions
        SET revoked_at = clock_timestamp()
        WHERE id = ${sessionId}::uuid
          AND revoked_at IS NULL
        RETURNING
          id,
          user_id AS "userId",
          revoked_at AS "revokedAt"
      `;

      return session ?? null;
    });
  }
}
