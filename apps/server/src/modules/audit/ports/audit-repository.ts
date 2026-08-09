export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditRecordSnapshot {
  id: string;
  tenantId: string;
  actorUserId: string;
  action: 'TEAM_CREATED';
  targetType: 'TEAM';
  targetId: string;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  requestId: string;
  occurredAt: Date;
}

export interface AuditRepository {
  record(record: AuditRecordSnapshot): Promise<void>;
}
