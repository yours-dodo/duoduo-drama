import { Inject, Injectable } from '@nestjs/common';

import {
  Space,
  type SpaceKind,
  type SpaceSnapshot,
} from '../../../domain/space/space.js';
import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type { SpaceRepository } from '../ports/space-repository.js';

@Injectable()
export class PrismaSpaceRepository implements SpaceRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  create(space: SpaceSnapshot): Promise<SpaceSnapshot> {
    return this.database.withClient(async (client) => {
      const persisted = await client.space.create({ data: space });
      const snapshot = toSnapshot(persisted);
      if (snapshot === null) {
        throw new Error('Created space could not be read');
      }
      return snapshot;
    });
  }

  ensurePersonalForUser(input: {
    id: string;
    ownerUserId: string;
    createdAt: Date;
  }): Promise<SpaceSnapshot> {
    return this.database.withClient(async (client) => {
      await client.$executeRaw`
        INSERT INTO "spaces" (
          "id",
          "kind",
          "owner_user_id",
          "created_at",
          "updated_at"
        )
        VALUES (
          ${input.id}::uuid,
          'personal',
          ${input.ownerUserId}::uuid,
          ${input.createdAt},
          ${input.createdAt}
        )
        ON CONFLICT ("owner_user_id") WHERE "kind" = 'personal' DO NOTHING
      `;

      const space = await client.space.findFirst({
        where: { kind: 'personal', ownerUserId: input.ownerUserId },
        orderBy: { createdAt: 'asc' },
      });
      if (space === null) {
        throw new Error('Personal space could not be initialized');
      }
      const snapshot = toSnapshot(space);
      if (snapshot === null) {
        throw new Error('Personal space could not be initialized');
      }
      return snapshot;
    });
  }

  findPersonalByUserId(userId: string): Promise<SpaceSnapshot | null> {
    return this.database.withClient(async (client) =>
      toSnapshot(
        await client.space.findFirst({
          where: { kind: 'personal', ownerUserId: userId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
    );
  }

  findTeamByTeamId(teamId: string): Promise<SpaceSnapshot | null> {
    return this.database.withClient(async (client) =>
      toSnapshot(
        await client.space.findFirst({
          where: { kind: 'team', ownerTeamId: teamId },
          orderBy: { createdAt: 'asc' },
        }),
      ),
    );
  }
}

function toSnapshot(
  row: {
    id: string;
    kind: string;
    ownerUserId: string | null;
    ownerTeamId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null,
): SpaceSnapshot | null {
  if (row === null) {
    return null;
  }

  return Space.fromSnapshot({
    id: row.id,
    kind: row.kind as SpaceKind,
    ownerUserId: row.ownerUserId,
    ownerTeamId: row.ownerTeamId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).toSnapshot();
}
