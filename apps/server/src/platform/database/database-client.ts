import type { DatabaseClientOperation } from './prisma.service.js';

export const DATABASE_CLIENT = Symbol('DATABASE_CLIENT');

export interface DatabaseClientProvider {
  withClient<T>(operation: DatabaseClientOperation<T>): Promise<T>;
}
