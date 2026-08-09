import { Inject, Injectable } from '@nestjs/common';

import type { TeamMembershipSnapshot } from '../../../domain/tenancy/team-membership.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';
import type {
  FindActiveMembershipRequest,
  TeamMemberListItem,
  TeamMembershipRepository,
} from '../ports/team-membership-repository.js';

interface TeamMembershipRow {
  id: string;
  tenantId: string;
  userId: string;
  role: string;
  joinedAt: Date;
  removedAt: Date | null;
}

interface TeamMemberRow extends TeamMembershipRow {
  email: string;
}

@Injectable()
export class PrismaTeamMembershipRepository implements TeamMembershipRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot> {
    return this.database.withClient((client) =>
      client.teamMembership.create({ data: membership }),
    ) as Promise<TeamMembershipSnapshot>;
  }

  update(membership: TeamMembershipSnapshot): Promise<TeamMembershipSnapshot> {
    return this.database.withClient((client) =>
      client.teamMembership.update({
        where: {
          tenantId_id: {
            tenantId: membership.tenantId,
            id: membership.id,
          },
        },
        data: membership,
      }),
    ) as Promise<TeamMembershipSnapshot>;
  }

  findActive(
    request: FindActiveMembershipRequest,
  ): Promise<TeamMembershipSnapshot | null> {
    return this.database.withClient(async (client) => {
      const membership = await client.teamMembership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: request.tenantId,
            userId: request.userId,
          },
          removedAt: null,
        },
      });
      return membership as TeamMembershipSnapshot | null;
    });
  }

  findByIdLocked(request: {
    tenantId: string;
    membershipId: string;
  }): Promise<TeamMembershipSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamMembershipRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          user_id AS "userId",
          role,
          joined_at AS "joinedAt",
          removed_at AS "removedAt"
        FROM team_memberships
        WHERE tenant_id = ${request.tenantId}::uuid
          AND id = ${request.membershipId}::uuid
        FOR UPDATE
      `;
      return readMembership(rows[0]);
    });
  }

  findByUserLocked(request: {
    tenantId: string;
    userId: string;
  }): Promise<TeamMembershipSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamMembershipRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          user_id AS "userId",
          role,
          joined_at AS "joinedAt",
          removed_at AS "removedAt"
        FROM team_memberships
        WHERE tenant_id = ${request.tenantId}::uuid
          AND user_id = ${request.userId}::uuid
        FOR UPDATE
      `;
      return readMembership(rows[0]);
    });
  }

  findActiveByEmail(request: {
    tenantId: string;
    email: string;
  }): Promise<TeamMembershipSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<TeamMembershipRow[]>`
        SELECT
          membership.id,
          membership.tenant_id AS "tenantId",
          membership.user_id AS "userId",
          membership.role,
          membership.joined_at AS "joinedAt",
          membership.removed_at AS "removedAt"
        FROM team_memberships AS membership
        INNER JOIN users AS app_user ON app_user.id = membership.user_id
        WHERE membership.tenant_id = ${request.tenantId}::uuid
          AND app_user.email = ${request.email}
          AND membership.removed_at IS NULL
      `;
      return readMembership(rows[0]);
    });
  }

  lockAdministration(tenantId: string): Promise<void> {
    return this.database.withClient(async (client) => {
      const lockKey = JSON.stringify(['team-administration', tenantId]);
      await client.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
    });
  }

  countActiveAdministrators(tenantId: string): Promise<number> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM team_memberships
        WHERE tenant_id = ${tenantId}::uuid
          AND role = 'admin'
          AND removed_at IS NULL
      `;
      return Number(rows[0]?.count ?? 0);
    });
  }

  listActive(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<TeamMemberListItem>> {
    return this.database.withClient(async (client) => {
      const after = page.after
        ? Prisma.sql`AND (membership.joined_at, membership.id) < (${page.after.at}, ${page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<TeamMemberRow[]>`
        SELECT
          membership.id,
          membership.tenant_id AS "tenantId",
          membership.user_id AS "userId",
          membership.role,
          membership.joined_at AS "joinedAt",
          membership.removed_at AS "removedAt",
          app_user.email
        FROM team_memberships AS membership
        INNER JOIN users AS app_user ON app_user.id = membership.user_id
        WHERE membership.tenant_id = ${tenantId}::uuid
          AND membership.removed_at IS NULL
          ${after}
        ORDER BY membership.joined_at DESC, membership.id DESC
        LIMIT ${page.limit + 1}
      `;
      const selected = rows.slice(0, page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map((row) => ({
          id: row.id,
          userId: row.userId,
          email: row.email,
          role: readRole(row.role),
          joinedAt: new Date(row.joinedAt),
        })),
        next:
          rows.length > page.limit && last
            ? { at: new Date(last.joinedAt), id: last.id }
            : null,
      };
    });
  }
}

function readMembership(
  row: TeamMembershipRow | undefined,
): TeamMembershipSnapshot | null {
  if (!row) return null;
  return {
    ...row,
    role: readRole(row.role),
    joinedAt: new Date(row.joinedAt),
    removedAt: row.removedAt === null ? null : new Date(row.removedAt),
  };
}

function readRole(role: string): 'admin' | 'member' {
  if (role !== 'admin' && role !== 'member') {
    throw new Error('Database returned an invalid team role');
  }
  return role;
}
