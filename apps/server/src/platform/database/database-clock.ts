import { Inject, Injectable } from '@nestjs/common';

import {
  DATABASE_CLIENT,
  type DatabaseClientProvider,
} from './database-client.js';

@Injectable()
export class DatabaseClock {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly database: DatabaseClientProvider,
  ) {}

  now(): Promise<Date> {
    return this.database.withClient(async (client) => {
      const [clock] = await client.$queryRaw<Array<{ databaseNow: Date }>>`
        SELECT clock_timestamp() AS "databaseNow"
      `;
      if (!clock) {
        throw new Error('Database clock query returned no rows');
      }
      return new Date(clock.databaseNow);
    });
  }
}
