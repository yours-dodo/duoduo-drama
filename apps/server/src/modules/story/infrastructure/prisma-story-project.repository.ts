import { Inject, Injectable } from '@nestjs/common';

import type { StoryProjectSnapshot } from '../../../domain/story/story-project.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { KeysetPage } from '../../../platform/pagination/keyset-page.js';
import type {
  StoryProjectListItem,
  StoryProjectListRequest,
  StoryProjectRepository,
} from '../ports/story-project-repository.js';

interface StoryProjectRow {
  id: string;
  tenantId: string;
  createdByUserId: string;
  title: string;
  visibility: string;
  status: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoryProjectListRow extends StoryProjectRow {
  collaborator: boolean;
}

@Injectable()
export class PrismaStoryProjectRepository implements StoryProjectRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(project: StoryProjectSnapshot): Promise<StoryProjectSnapshot> {
    return this.database.withClient((client) =>
      client.storyProject.create({ data: project }),
    ) as Promise<StoryProjectSnapshot>;
  }

  update(project: StoryProjectSnapshot): Promise<StoryProjectSnapshot> {
    return this.database.withClient((client) =>
      client.storyProject.update({
        where: { tenantId_id: { tenantId: project.tenantId, id: project.id } },
        data: project,
      }),
    ) as Promise<StoryProjectSnapshot>;
  }

  findById(request: {
    tenantId: string;
    projectId: string;
  }): Promise<StoryProjectSnapshot | null> {
    return this.database.withClient(async (client) => {
      const project = await client.storyProject.findUnique({
        where: {
          tenantId_id: {
            tenantId: request.tenantId,
            id: request.projectId,
          },
        },
      });
      return project === null ? null : readProject(project);
    });
  }

  findByIdLocked(request: {
    tenantId: string;
    projectId: string;
  }): Promise<StoryProjectSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryProjectRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          created_by_user_id AS "createdByUserId",
          title,
          visibility,
          status,
          revision,
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM story_projects
        WHERE tenant_id = ${request.tenantId}::uuid
          AND id = ${request.projectId}::uuid
        FOR UPDATE
      `;
      return rows[0] === undefined ? null : readProject(rows[0]);
    });
  }

  listVisible(
    request: StoryProjectListRequest,
  ): Promise<KeysetPage<StoryProjectListItem>> {
    return this.database.withClient(async (client) => {
      const after = request.page.after
        ? Prisma.sql`AND (project.created_at, project.id) < (${request.page.after.at}, ${request.page.after.id}::uuid)`
        : Prisma.empty;
      const visibility =
        request.actorRole === 'admin'
          ? Prisma.empty
          : Prisma.sql`AND (project.visibility = 'team' OR project.created_by_user_id = ${request.actorUserId}::uuid)`;
      const rows = await client.$queryRaw<StoryProjectListRow[]>`
        SELECT
          project.id,
          project.tenant_id AS "tenantId",
          project.created_by_user_id AS "createdByUserId",
          project.title,
          project.visibility,
          project.status,
          project.revision,
          project.created_at AS "createdAt",
          project.updated_at AS "updatedAt",
          EXISTS (
            SELECT 1
            FROM project_collaborators AS collaborator
            WHERE collaborator.tenant_id = project.tenant_id
              AND collaborator.project_id = project.id
              AND collaborator.user_id = ${request.actorUserId}::uuid
          ) AS collaborator
        FROM story_projects AS project
        WHERE project.tenant_id = ${request.tenantId}::uuid
          ${visibility}
          ${after}
        ORDER BY project.created_at DESC, project.id DESC
        LIMIT ${request.page.limit + 1}
      `;
      const selected = rows.slice(0, request.page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(readProjectListItem),
        next:
          rows.length > request.page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }
}

function readProject(row: StoryProjectRow): StoryProjectSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    visibility: readVisibility(row.visibility),
    status: readStatus(row.status),
    revision: Number(row.revision),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function readProjectListItem(row: StoryProjectListRow): StoryProjectListItem {
  return { ...readProject(row), collaborator: Boolean(row.collaborator) };
}

function readVisibility(value: string): 'team' | 'private' {
  if (value !== 'team' && value !== 'private') {
    throw new Error('Database returned an invalid story project visibility');
  }
  return value;
}

function readStatus(value: string): 'active' | 'archived' {
  if (value !== 'active' && value !== 'archived') {
    throw new Error('Database returned an invalid story project status');
  }
  return value;
}
