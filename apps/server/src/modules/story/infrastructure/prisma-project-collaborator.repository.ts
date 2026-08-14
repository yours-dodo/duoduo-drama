import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  isProjectCollaboratorRole,
  isProjectPermissionKey,
  type ProjectCollaboratorRole,
  type ProjectPermissionEffect,
  type ProjectPermissionKey,
} from '../../../domain/story/project-collaborator.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import type {
  ProjectCollaboratorListItem,
  ProjectCollaboratorPermissionOverrideSnapshot,
  ProjectCollaboratorRepository,
  ProjectCollaboratorSnapshot,
} from '../ports/project-collaborator-repository.js';

interface CollaboratorRow {
  id: string;
  tenantId: string;
  projectId: string;
  userId: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  email?: string;
}

interface PermissionOverrideRow {
  id: string;
  collaboratorId: string;
  permissionKey: string;
  effect: string;
  grantedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaProjectCollaboratorRepository implements ProjectCollaboratorRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(
    collaborator: ProjectCollaboratorSnapshot,
  ): Promise<ProjectCollaboratorSnapshot> {
    return this.database.withClient((client) =>
      client.projectCollaborator.create({
        data: {
          id: collaborator.id,
          tenantId: collaborator.tenantId,
          projectId: collaborator.projectId,
          userId: collaborator.userId,
          role: collaborator.role,
          createdAt: collaborator.createdAt,
          updatedAt: collaborator.updatedAt,
          revokedAt: collaborator.revokedAt,
        },
      }),
    ) as Promise<ProjectCollaboratorSnapshot>;
  }

  findByProjectAndUserLocked(request: {
    tenantId: string;
    projectId: string;
    userId: string;
  }): Promise<ProjectCollaboratorSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<CollaboratorRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          user_id AS "userId",
          role,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          revoked_at AS "revokedAt"
        FROM project_collaborators
        WHERE tenant_id = ${request.tenantId}::uuid
          AND project_id = ${request.projectId}::uuid
          AND user_id = ${request.userId}::uuid
          AND revoked_at IS NULL
        FOR UPDATE
      `;
      return rows[0] === undefined ? null : readCollaborator(rows[0]);
    });
  }

  listPermissionOverrides(request: {
    collaboratorId: string;
  }): Promise<ProjectCollaboratorPermissionOverrideSnapshot[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<PermissionOverrideRow[]>`
        SELECT
          id,
          collaborator_id AS "collaboratorId",
          permission_key AS "permissionKey",
          effect,
          granted_by_user_id AS "grantedByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM project_collaborator_permission_overrides
        WHERE collaborator_id = ${request.collaboratorId}::uuid
        ORDER BY permission_key ASC
      `;
      return rows.map(readPermissionOverride);
    });
  }

  listForProject(request: {
    tenantId: string;
    projectId: string;
    page: KeysetPageRequest;
  }): Promise<{
    items: ProjectCollaboratorListItem[];
    next: { at: Date; id: string } | null;
  }> {
    return this.database.withClient(async (client) => {
      const after = request.page.after
        ? Prisma.sql`AND (collaborator.created_at, collaborator.id) < (${request.page.after.at}, ${request.page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<CollaboratorRow[]>`
        SELECT
          collaborator.id,
          collaborator.tenant_id AS "tenantId",
          collaborator.project_id AS "projectId",
          collaborator.user_id AS "userId",
          collaborator.role,
          collaborator.created_at AS "createdAt",
          collaborator.updated_at AS "updatedAt",
          collaborator.revoked_at AS "revokedAt",
          app_user.email
        FROM project_collaborators AS collaborator
        INNER JOIN users AS app_user ON app_user.id = collaborator.user_id
        WHERE collaborator.tenant_id = ${request.tenantId}::uuid
          AND collaborator.project_id = ${request.projectId}::uuid
          AND collaborator.revoked_at IS NULL
          ${after}
        ORDER BY collaborator.created_at DESC, collaborator.id DESC
        LIMIT ${request.page.limit + 1}
      `;
      const selected = rows.slice(0, request.page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map((row) => ({
          ...readCollaborator(row),
          email:
            row.email ??
            (() => {
              throw new Error('Database collaborator email is missing');
            })(),
        })),
        next:
          rows.length > request.page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }

  async updateRole(request: {
    tenantId: string;
    projectId: string;
    userId: string;
    role: ProjectCollaboratorRole;
    updatedAt: Date;
  }): Promise<ProjectCollaboratorSnapshot> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<CollaboratorRow[]>`
        UPDATE project_collaborators
        SET role = ${request.role}, updated_at = ${request.updatedAt}
        WHERE tenant_id = ${request.tenantId}::uuid
          AND project_id = ${request.projectId}::uuid
          AND user_id = ${request.userId}::uuid
          AND revoked_at IS NULL
        RETURNING
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          user_id AS "userId",
          role,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          revoked_at AS "revokedAt"
      `;
      if (rows[0] === undefined) {
        throw new Error('Project collaborator role update target is missing');
      }
      return readCollaborator(rows[0]);
    });
  }

  async upsertPermissionOverride(override: {
    id: string;
    collaboratorId: string;
    permissionKey: ProjectPermissionKey;
    effect: ProjectPermissionEffect;
    grantedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<ProjectCollaboratorPermissionOverrideSnapshot> {
    return this.database.withClient(async (client) => {
      const row = await client.projectCollaboratorPermissionOverride.upsert({
        where: {
          collaboratorId_permissionKey: {
            collaboratorId: override.collaboratorId,
            permissionKey: override.permissionKey,
          },
        },
        create: override,
        update: {
          effect: override.effect,
          grantedByUserId: override.grantedByUserId,
          updatedAt: override.updatedAt,
        },
      });
      return readPermissionOverride(row);
    });
  }

  async removePermissionOverride(request: {
    collaboratorId: string;
    permissionKey: ProjectPermissionKey;
  }): Promise<void> {
    await this.database.withClient((client) =>
      client.projectCollaboratorPermissionOverride.deleteMany({
        where: {
          collaboratorId: request.collaboratorId,
          permissionKey: request.permissionKey,
        },
      }),
    );
  }

  async remove(request: {
    tenantId: string;
    projectId: string;
    userId: string;
    revokedAt: Date;
  }): Promise<void> {
    await this.database.withClient((client) =>
      client.projectCollaborator.updateMany({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
          userId: request.userId,
          revokedAt: null,
        },
        data: { revokedAt: request.revokedAt, updatedAt: request.revokedAt },
      }),
    );
  }

  async removeAll(request: {
    tenantId: string;
    projectId: string;
    revokedAt: Date;
  }): Promise<number> {
    const result = await this.database.withClient((client) =>
      client.projectCollaborator.updateMany({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
          revokedAt: null,
        },
        data: { revokedAt: request.revokedAt, updatedAt: request.revokedAt },
      }),
    );
    return result.count;
  }
}

function readCollaborator(row: CollaboratorRow): ProjectCollaboratorSnapshot {
  if (!isProjectCollaboratorRole(row.role)) {
    throw new Error('Database returned an invalid project collaborator role');
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    userId: row.userId,
    role: row.role,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    revokedAt: row.revokedAt === null ? null : new Date(row.revokedAt),
  };
}

function readPermissionOverride(
  row: PermissionOverrideRow,
): ProjectCollaboratorPermissionOverrideSnapshot {
  if (!isProjectPermissionKey(row.permissionKey)) {
    throw new Error(
      'Database returned an invalid project collaborator permission key',
    );
  }
  if (row.effect !== 'allow' && row.effect !== 'deny') {
    throw new Error(
      'Database returned an invalid project collaborator permission effect',
    );
  }
  return {
    id: row.id,
    collaboratorId: row.collaboratorId,
    permissionKey: row.permissionKey,
    effect: row.effect,
    grantedByUserId: row.grantedByUserId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}
