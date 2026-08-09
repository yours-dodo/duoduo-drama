import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  FindOrCreateUserRequest,
  IdentityUserSnapshot,
  UserRepository,
} from '../ports/user-repository.js';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  findOrCreateByEmail(
    request: FindOrCreateUserRequest,
  ): Promise<IdentityUserSnapshot> {
    return this.database.withClient((client) =>
      client.user.upsert({
        where: { email: request.email },
        create: { id: request.newUserId, email: request.email },
        update: {},
        select: { id: true, email: true, createdAt: true },
      }),
    );
  }
}
