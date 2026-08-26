export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
export const AUDIT_QUERY_REPOSITORY = Symbol('AUDIT_QUERY_REPOSITORY');

export interface AuditRecordSnapshot {
  id: string;
  tenantId: string | null;
  spaceId?: string | null;
  actorUserId: string;
  action:
    | 'TEAM_CREATED'
    | 'TEAM_INVITATION_CREATED'
    | 'TEAM_INVITATION_REVOKED'
    | 'TEAM_MEMBER_JOINED'
    | 'TEAM_MEMBER_ROLE_CHANGED'
    | 'TEAM_MEMBER_REMOVED'
    | 'STORY_PROJECT_CREATED'
    | 'STORY_PROJECT_UPDATED'
    | 'STORY_PROJECT_VISIBILITY_CHANGED'
    | 'STORY_PROJECT_ARCHIVED'
    | 'STORY_PROJECT_RESTORED'
    | 'STORY_PROJECT_PURGED'
    | 'STORY_PROJECT_PRIVATE_VIEWED'
    | 'STORY_ROLE_ASSET_CREATED'
    | 'STORY_ROLE_ASSET_UPDATED'
    | 'STORY_ROLE_ASSET_ARCHIVED'
    | 'STORY_IMPORT_JOB_CREATED'
    | 'STORY_PROJECT_COLLABORATOR_ADDED'
    | 'STORY_PROJECT_COLLABORATOR_ROLE_CHANGED'
    | 'STORY_PROJECT_COLLABORATOR_PERMISSION_CHANGED'
    | 'STORY_PROJECT_COLLABORATOR_REMOVED'
    | 'STORY_ARTIFACT_DRAFT_EDITED'
    | 'STORY_ARTIFACT_DRAFT_DISCARDED'
    | 'STORY_ARTIFACT_VERSION_CONFIRMED'
    | 'STORY_ARTIFACT_VERSION_ROLLED_BACK';
  targetType:
    | 'TEAM'
    | 'TEAM_INVITATION'
    | 'TEAM_MEMBERSHIP'
    | 'STORY_PROJECT'
    | 'STORY_ROLE_ASSET'
    | 'STORY_IMPORT_JOB'
    | 'PROJECT_COLLABORATOR'
    | 'STORY_ARTIFACT'
    | 'STORY_ARTIFACT_VERSION';
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
  listForTarget(request: {
    tenantId?: string | null;
    spaceId?: string | null;
    targetType: AuditRecordSnapshot['targetType'];
    targetId: string;
    page: KeysetPageRequest;
  }): Promise<KeysetPage<AuditRecordSnapshot>>;
}
import type {
  KeysetPage,
  KeysetPageRequest,
} from '../../../platform/pagination/keyset-page.js';
