import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { KeysetPage } from '../../../platform/pagination/keyset-page.js';
import type {
  AssetRepository,
  AssetSnapshot,
  AssetStatus,
} from '../ports/asset-repository.js';

interface AssetRow {
  id: string;
  tenantId: string | null;
  projectId: string;
  uploadedByUserId: string;
  objectKey: string;
  originalFileName: string;
  contentType: string;
  byteSize: number;
  checksum: string | null;
  status: string;
  uploadExpiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaAssetRepository implements AssetRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(asset: AssetSnapshot): Promise<AssetSnapshot> {
    return this.database.withClient((client) =>
      client.asset.create({ data: asset }),
    ) as Promise<AssetSnapshot>;
  }

  findById(request: {
    tenantId: string | null;
    projectId: string;
    assetId: string;
  }): Promise<AssetSnapshot | null> {
    return this.database.withClient(async (client) => {
      const asset = await client.asset.findFirst({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
          id: request.assetId,
        },
      });
      return asset === null ? null : readAsset(asset);
    });
  }

  hasRoleReferences(request: {
    tenantId: string | null;
    projectId: string;
    assetId: string;
  }): Promise<boolean> {
    return this.database.withClient(async (client) => {
      const rows = await client.$queryRaw<Array<{ referenced: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM story_role_assets AS role
          WHERE role.project_id = ${request.projectId}::uuid
            AND ${tenantScope(request.tenantId, 'role')}
            AND role.archived_at IS NULL
            AND (
              role.cover_asset_id = ${request.assetId}::uuid
              OR role.view_asset_id = ${request.assetId}::uuid
            )
        ) AS referenced
      `;
      return rows[0]?.referenced === true;
    });
  }

  listForProject(request: {
    tenantId: string | null;
    projectId: string;
    page: { limit: number; after: { at: Date; id: string } | null };
  }): Promise<KeysetPage<AssetSnapshot>> {
    return this.database.withClient(async (client) => {
      const after = request.page.after
        ? Prisma.sql`AND (asset.created_at, asset.id) < (${request.page.after.at}, ${request.page.after.id}::uuid)`
        : Prisma.empty;
      const rows = await client.$queryRaw<AssetRow[]>`
        SELECT
          asset.id,
          asset.tenant_id AS "tenantId",
          asset.project_id AS "projectId",
          asset.uploaded_by_user_id AS "uploadedByUserId",
          asset.object_key AS "objectKey",
          asset.original_file_name AS "originalFileName",
          asset.content_type AS "contentType",
          asset.byte_size AS "byteSize",
          asset.checksum,
          asset.status,
          asset.upload_expires_at AS "uploadExpiresAt",
          asset.completed_at AS "completedAt",
          asset.created_at AS "createdAt",
          asset.updated_at AS "updatedAt"
        FROM assets AS asset
        WHERE ${tenantScope(request.tenantId)}
          AND asset.project_id = ${request.projectId}::uuid
          AND asset.status <> 'deleted'
          ${after}
        ORDER BY asset.created_at DESC, asset.id DESC
        LIMIT ${request.page.limit + 1}
      `;
      const selected = rows.slice(0, request.page.limit);
      const last = selected.at(-1);
      return {
        items: selected.map(readAsset),
        next:
          rows.length > request.page.limit && last
            ? { at: new Date(last.createdAt), id: last.id }
            : null,
      };
    });
  }

  transition(request: {
    tenantId: string | null;
    projectId: string;
    assetId: string;
    from: AssetStatus | readonly AssetStatus[];
    to: AssetStatus;
    completedAt?: Date | null;
    checksum?: string | null;
  }): Promise<AssetSnapshot | null> {
    return this.database.withClient(async (client) => {
      const from = Array.isArray(request.from) ? request.from : [request.from];
      const result = await client.asset.updateMany({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
          id: request.assetId,
          status: { in: from },
        },
        data: {
          status: request.to,
          ...(request.completedAt === undefined
            ? {}
            : { completedAt: request.completedAt }),
          ...(request.checksum === undefined
            ? {}
            : { checksum: request.checksum }),
        },
      });
      if (result.count === 0) return null;
      const asset = await client.asset.findFirst({
        where: {
          tenantId: request.tenantId,
          projectId: request.projectId,
          id: request.assetId,
        },
      });
      return asset === null ? null : readAsset(asset);
    });
  }
}

function readAsset(row: AssetRow): AssetSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId,
    projectId: row.projectId,
    uploadedByUserId: row.uploadedByUserId,
    objectKey: row.objectKey,
    originalFileName: row.originalFileName,
    contentType: row.contentType,
    byteSize: Number(row.byteSize),
    checksum: row.checksum,
    status: readStatus(row.status),
    uploadExpiresAt: new Date(row.uploadExpiresAt),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function tenantScope(tenantId: string | null, alias = 'asset') {
  const tenantColumn =
    alias === 'role'
      ? Prisma.sql`role.tenant_id`
      : Prisma.sql`asset.tenant_id`;
  return tenantId === null
    ? Prisma.sql`${tenantColumn} IS NULL`
    : Prisma.sql`${tenantColumn} = ${tenantId}::uuid`;
}

function readStatus(value: string): AssetStatus {
  if (
    value !== 'pending_upload' &&
    value !== 'uploaded' &&
    value !== 'failed' &&
    value !== 'deleted'
  ) {
    throw new Error('Database returned an invalid asset status');
  }
  return value;
}
