export const IDEMPOTENCY_REPOSITORY = Symbol('IDEMPOTENCY_REPOSITORY');

export interface IdempotencyLookup {
  scopeKey: string;
  operationType:
    | 'CREATE_TEAM'
    | 'CREATE_TEAM_INVITATION'
    | 'CREATE_STORY_PROJECT'
    | 'CREATE_STORY_ROLE_ASSET'
    | 'CREATE_STORY_IMPORT_JOB'
    | 'CREATE_STORY_CONVERSATION'
    | 'APPEND_STORY_MESSAGE'
    | 'CONFIRM_STORY_ARTIFACT_VERSION'
    | 'SAVE_STORY_OUTLINE';
  idempotencyKey: string;
}

export interface IdempotencyRecordSnapshot extends IdempotencyLookup {
  id: string;
  tenantId: string | null;
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
