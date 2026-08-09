import { Inject, Injectable } from '@nestjs/common';

import type { TeamInvitationSnapshot } from '../../../domain/tenancy/team-invitation.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';
import type { TeamInvitationRepository } from '../ports/team-invitation-repository.js';

type TeamInvitationRow = TeamInvitationSnapshot;

@Injectable()
export class PrismaTeamInvitationRepository implements TeamInvitationRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(invitation: TeamInvitationSnapshot): Promise<TeamInvitationSnapshot> {
    return this.database.withClient((client) =>
      client.teamInvitation.create({ data: invitation }),
    );
  }

  update(invitation: TeamInvitationSnapshot): Promise<TeamInvitationSnapshot> {
    return this.database.withClient((client) =>
      client.teamInvitation.update({
        where: { id: invitation.id, tenantId: invitation.tenantId },
        data: invitation,
      }),
    );
  }

  findById(request: {
    tenantId: string;
    invitationId: string;
  }): Promise<TeamInvitationSnapshot | null> {
    return this.database.withClient((client) =>
      client.teamInvitation.findFirst({
        where: { id: request.invitationId, tenantId: request.tenantId },
      }),
    );
  }

  findByIdLocked(request: {
    tenantId: string;
    invitationId: string;
  }): Promise<TeamInvitationSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamInvitationRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          email,
          invited_by_user_id AS "invitedByUserId",
          token_hash AS "tokenHash",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          accepted_at AS "acceptedAt",
          accepted_by_user_id AS "acceptedByUserId",
          revoked_at AS "revokedAt"
        FROM team_invitations
        WHERE tenant_id = ${request.tenantId}::uuid
          AND id = ${request.invitationId}::uuid
        FOR UPDATE
      `;
      return rows[0] ?? null;
    });
  }

  findPendingByEmailLocked(request: {
    tenantId: string;
    email: string;
  }): Promise<TeamInvitationSnapshot | null> {
    return this.database.withClient(async (client) => {
      const lockKey = JSON.stringify([
        'team-invitation-email',
        request.tenantId,
        request.email,
      ]);
      await client.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
      return client.teamInvitation.findFirst({
        where: {
          tenantId: request.tenantId,
          email: request.email,
          acceptedAt: null,
          revokedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });
  }

  findByTokenHashLocked(
    tokenHash: string,
  ): Promise<TeamInvitationSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamInvitationRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          email,
          invited_by_user_id AS "invitedByUserId",
          token_hash AS "tokenHash",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          accepted_at AS "acceptedAt",
          accepted_by_user_id AS "acceptedByUserId",
          revoked_at AS "revokedAt"
        FROM team_invitations
        WHERE token_hash = ${tokenHash}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    });
  }

  listForTenant(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<TeamInvitationSnapshot>> {
    return this.database.withClient(async (client) => {
      const after = page.after
        ? Prisma.sql`AND (created_at, id) < (${page.after.at}, ${page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<TeamInvitationRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          email,
          invited_by_user_id AS "invitedByUserId",
          token_hash AS "tokenHash",
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          accepted_at AS "acceptedAt",
          accepted_by_user_id AS "acceptedByUserId",
          revoked_at AS "revokedAt"
        FROM team_invitations
        WHERE tenant_id = ${tenantId}::uuid
          ${after}
        ORDER BY created_at DESC, id DESC
        LIMIT ${page.limit + 1}
      `;
      const items = rows.slice(0, page.limit);
      const last = items.at(-1);
      return {
        items,
        next:
          rows.length > page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }
}
