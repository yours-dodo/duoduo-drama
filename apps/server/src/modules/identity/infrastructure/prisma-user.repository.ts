import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import { DatabaseClock } from '../../../platform/database/database-clock.js';
import {
  SPACE_REPOSITORY,
  type SpaceRepository,
} from '../../spaces/ports/space-repository.js';
import type {
  FindOrCreateUserRequest,
  IdentityUserSnapshot,
  UserRepository,
} from '../ports/user-repository.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
    @Inject(SPACE_REPOSITORY) private readonly spaces: SpaceRepository,
    private readonly databaseClock: DatabaseClock,
  ) {}

  findOrCreateByEmail(
    request: FindOrCreateUserRequest,
  ): Promise<IdentityUserSnapshot> {
    return this.database.withClient(async (client) => {
      const user = await client.user.upsert({
        where: { email: request.email },
        create: { id: request.newUserId, email: request.email },
        update: {},
        select: { id: true, email: true, createdAt: true },
      });

      const personalSpace = await this.spaces.findPersonalByUserId(user.id);
      if (personalSpace === null) {
        const createdAt = await this.databaseClock.now();
        await this.spaces.ensurePersonalForUser({
          id: randomUUID(),
          ownerUserId: user.id,
          createdAt,
        });
      }

      return user;
    });
  }
}
