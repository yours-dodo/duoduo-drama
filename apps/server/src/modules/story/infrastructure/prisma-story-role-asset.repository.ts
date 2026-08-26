import { Inject, Injectable } from '@nestjs/common';

import type { StoryRoleAssetSnapshot } from '../../../domain/story/story-role-asset.js';
import {
  STORY_ROLE_APPEARANCE_FREQUENCIES,
  STORY_ROLE_CAMPS,
  STORY_ROLE_CATEGORIES,
  EMPTY_STORY_ROLE_SPEECH_PROFILE,
  STORY_ROLE_GENDERS,
  type StoryRoleSpeechProfile,
} from '../../../domain/story/story-role-asset.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { StoryRoleAssetRepository } from '../ports/story-role-asset-repository.js';

interface StoryRoleAssetRow {
  id: string;
  tenantId: string | null;
  projectId: string;
  category: string;
  name: string;
  occupation: string;
  personalityCore: string;
  motivationConflict: string;
  mainlineRelation: string;
  gender: string;
  camp: string;
  appearanceFrequency: string;
  speechProfile: StoryRoleSpeechProfile;
  coverAssetId: string | null;
  viewAssetId: string | null;
  revision: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

@Injectable()
export class PrismaStoryRoleAssetRepository implements StoryRoleAssetRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(role: StoryRoleAssetSnapshot): Promise<StoryRoleAssetSnapshot> {
    return this.database.withClient(async (client) =>
      readRole(
        (await client.storyRoleAsset.create({
          data: {
            ...role,
            speechProfile:
              role.speechProfile as unknown as Prisma.InputJsonValue,
          },
        })) as unknown as StoryRoleAssetRow,
      ),
    );
  }

  update(role: StoryRoleAssetSnapshot): Promise<StoryRoleAssetSnapshot> {
    return this.database.withClient(async (client) =>
      readRole(
        (await client.storyRoleAsset.update({
          where: { id: role.id },
          data: {
            ...role,
            speechProfile:
              role.speechProfile as unknown as Prisma.InputJsonValue,
          },
        })) as unknown as StoryRoleAssetRow,
      ),
    );
  }

  findById(request: {
    tenantId: string | null;
    projectId: string;
    roleId: string;
  }): Promise<StoryRoleAssetSnapshot | null> {
    return this.database.withClient(async (client) => {
      const role = await client.storyRoleAsset.findFirst({
        where: {
          id: request.roleId,
          tenantId: request.tenantId,
          projectId: request.projectId,
          archivedAt: null,
        },
      });
      return role === null
        ? null
        : readRole(role as unknown as StoryRoleAssetRow);
    });
  }

  findByIdLocked(request: {
    tenantId: string | null;
    projectId: string;
    roleId: string;
  }): Promise<StoryRoleAssetSnapshot | null> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryRoleAssetRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          category,
          name,
          occupation,
          personality_core AS "personalityCore",
          motivation_conflict AS "motivationConflict",
          mainline_relation AS "mainlineRelation",
          gender,
          camp,
          appearance_frequency AS "appearanceFrequency",
          speech_profile AS "speechProfile",
          cover_asset_id AS "coverAssetId",
          view_asset_id AS "viewAssetId",
          revision,
          created_by_user_id AS "createdByUserId",
          updated_by_user_id AS "updatedByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM story_role_assets
        WHERE id = ${request.roleId}::uuid
          AND project_id = ${request.projectId}::uuid
          AND ${tenantScope(request.tenantId)}
          AND archived_at IS NULL
        FOR UPDATE
      `;
      return rows[0] === undefined ? null : readRole(rows[0]);
    });
  }

  listByProject(request: {
    tenantId: string | null;
    projectId: string;
  }): Promise<StoryRoleAssetSnapshot[]> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<StoryRoleAssetRow[]>`
        SELECT
          id,
          tenant_id AS "tenantId",
          project_id AS "projectId",
          category,
          name,
          occupation,
          personality_core AS "personalityCore",
          motivation_conflict AS "motivationConflict",
          mainline_relation AS "mainlineRelation",
          gender,
          camp,
          appearance_frequency AS "appearanceFrequency",
          speech_profile AS "speechProfile",
          cover_asset_id AS "coverAssetId",
          view_asset_id AS "viewAssetId",
          revision,
          created_by_user_id AS "createdByUserId",
          updated_by_user_id AS "updatedByUserId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt"
        FROM story_role_assets
        WHERE project_id = ${request.projectId}::uuid
          AND ${tenantScope(request.tenantId)}
          AND archived_at IS NULL
        ORDER BY
          CASE category
            WHEN 'protagonists' THEN 1
            WHEN 'core' THEN 2
            WHEN 'supporting' THEN 3
            ELSE 4
          END,
          CASE appearance_frequency
            WHEN '高频' THEN 1
            WHEN '中频' THEN 2
            WHEN '低频' THEN 3
            ELSE 4
          END,
          created_at,
          id
      `;
      return rows.map(readRole);
    });
  }
}

@Injectable()
export class NoopStoryRoleAssetReferenceRepository {
  async hasReferences(): Promise<boolean> {
    return false;
  }
}

function tenantScope(tenantId: string | null) {
  return tenantId === null
    ? Prisma.sql`tenant_id IS NULL`
    : Prisma.sql`tenant_id = ${tenantId}::uuid`;
}

function readRole(row: StoryRoleAssetRow): StoryRoleAssetSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    category: readOption(STORY_ROLE_CATEGORIES, row.category),
    name: row.name,
    occupation: row.occupation,
    personalityCore: row.personalityCore,
    motivationConflict: row.motivationConflict,
    mainlineRelation: row.mainlineRelation,
    gender: readOption(STORY_ROLE_GENDERS, row.gender),
    camp: readOption(STORY_ROLE_CAMPS, row.camp),
    appearanceFrequency: readOption(
      STORY_ROLE_APPEARANCE_FREQUENCIES,
      row.appearanceFrequency,
    ),
    speechProfile: readSpeechProfile(row.speechProfile),
    coverAssetId: row.coverAssetId,
    viewAssetId: row.viewAssetId,
    revision: Number(row.revision),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    archivedAt: row.archivedAt === null ? null : new Date(row.archivedAt),
  };
}

function readSpeechProfile(value: unknown): StoryRoleSpeechProfile {
  if (typeof value !== 'object' || value === null) {
    return { ...EMPTY_STORY_ROLE_SPEECH_PROFILE };
  }
  return value as StoryRoleSpeechProfile;
}

function readOption<T extends string>(options: readonly T[], value: string): T {
  if (!options.includes(value as T)) {
    throw new Error('Database returned an invalid story role asset option');
  }
  return value as T;
}
