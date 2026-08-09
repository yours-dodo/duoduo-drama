import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { KeysetPageRequest } from '../../../platform/pagination/keyset-page.js';
import type {
  ProjectCollaboratorListItem,
  ProjectCollaboratorRepository,
  ProjectCollaboratorSnapshot,
} from '../ports/project-collaborator-repository.js';

interface CollaboratorRow extends ProjectCollaboratorSnapshot {
  email?: string;
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
      client.projectCollaborator.create({ data: collaborator }),
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
          created_at AS "createdAt"
        FROM project_collaborators
        WHERE tenant_id = ${request.tenantId}::uuid
          AND project_id = ${request.projectId}::uuid
          AND user_id = ${request.userId}::uuid
        FOR UPDATE
      `;
      return rows[0] === undefined ? null : readCollaborator(rows[0]);
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
          collaborator.created_at AS "createdAt",
          app_user.email
        FROM project_collaborators AS collaborator
        INNER JOIN users AS app_user ON app_user.id = collaborator.user_id
        WHERE collaborator.tenant_id = ${request.tenantId}::uuid
          AND collaborator.project_id = ${request.projectId}::uuid
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

  async remove(request: {
    tenantId: string;
    projectId: string;
    userId: string;
  }): Promise<void> {
    await this.database.withClient((client) =>
      client.projectCollaborator.delete({
        where: {
          tenantId_projectId_userId: {
            tenantId: request.tenantId,
            projectId: request.projectId,
            userId: request.userId,
          },
        },
      }),
    );
  }

  async removeAll(request: {
    tenantId: string;
    projectId: string;
  }): Promise<number> {
    const result = await this.database.withClient((client) =>
      client.projectCollaborator.deleteMany({
        where: { tenantId: request.tenantId, projectId: request.projectId },
      }),
    );
    return result.count;
  }
}

function readCollaborator(row: CollaboratorRow): ProjectCollaboratorSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    userId: row.userId,
    createdAt: new Date(row.createdAt),
  };
}
