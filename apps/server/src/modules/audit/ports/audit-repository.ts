export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
export const AUDIT_QUERY_REPOSITORY = Symbol('AUDIT_QUERY_REPOSITORY');

export interface AuditRecordSnapshot {
  id: string;
  tenantId: string;
  actorUserId: string;
  action:
    | 'TEAM_CREATED'
    | 'TEAM_INVITATION_CREATED'
    | 'TEAM_INVITATION_REVOKED'
    | 'TEAM_MEMBER_JOINED'
    | 'TEAM_MEMBER_ROLE_CHANGED'
    | 'TEAM_MEMBER_REMOVED';
  targetType: 'TEAM' | 'TEAM_INVITATION' | 'TEAM_MEMBERSHIP';
  targetId: string;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  requestId: string;
  occurredAt: Date;
}

export interface AuditRepository {
  record(record: AuditRecordSnapshot): Promise<void>;
}

export interface AuditQueryRepository {
  listForTenant(
    tenantId: string,
    page: KeysetPageRequest,
  ): Promise<KeysetPage<AuditRecordSnapshot>>;
}
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';
