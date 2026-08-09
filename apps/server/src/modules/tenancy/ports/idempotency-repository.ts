export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export interface IdempotencyLookup {
  scopeKey: string;
  operationType:
    'CREATE_TEAM' | 'CREATE_TEAM_INVITATION' | 'CREATE_STORY_PROJECT';
  idempotencyKey: string;
}

export interface IdempotencyRecordSnapshot extends IdempotencyLookup {
  id: string;
  tenantId: string;
  requestHash: string;
  resultId: string;
  createdAt: Date;
}

export interface IdempotencyRepository {
  findLocked(
    lookup: IdempotencyLookup,
  ): Promise<IdempotencyRecordSnapshot | null>;
  create(record: IdempotencyRecordSnapshot): Promise<IdempotencyRecordSnapshot>;
}
