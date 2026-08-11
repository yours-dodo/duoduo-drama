import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  PasswordCredentialRepository,
  PasswordCredentialSnapshot,
} from '../ports/password-credential-repository.js';

@Injectable()
export class PrismaPasswordCredentialRepository implements PasswordCredentialRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  findByEmail(email: string): Promise<PasswordCredentialSnapshot | null> {
    return this.database.withClient(async (client) => {
      const user = await client.user.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      });
      return user === null
        ? null
        : {
            userId: user.id,
            email: user.email,
            passwordHash: user.passwordHash,
          };
    });
  }

  findByUserId(userId: string): Promise<PasswordCredentialSnapshot | null> {
    return this.database.withClient(async (client) => {
      const user = await client.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, passwordHash: true },
      });
      return user === null
        ? null
        : {
            userId: user.id,
            email: user.email,
            passwordHash: user.passwordHash,
          };
    });
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.database.withClient((client) =>
      client.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
    );
  }
}
