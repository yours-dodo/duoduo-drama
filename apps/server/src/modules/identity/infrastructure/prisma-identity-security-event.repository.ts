import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from '../../../platform/database/database-client.js';
import type {
  IdentitySecurityEventRepository,
  IdentitySecurityEventSnapshot,
} from '../ports/identity-security-event-repository.js';

@Injectable()
export class PrismaIdentitySecurityEventRepository implements IdentitySecurityEventRepository {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  async record(event: IdentitySecurityEventSnapshot): Promise<void> {
    await this.database.withClient((client) =>
      client.identitySecurityEvent.create({ data: event }),
    );
  }
}
