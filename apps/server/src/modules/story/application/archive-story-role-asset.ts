import {
  StoryRoleAsset,
  type StoryRoleAssetSnapshot,
} from '../../../domain/story/story-role-asset.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { readStoryRoleProjectAccess } from './story-role-asset-access.js';
import {
  StoryRoleAssetInUseError,
  StoryRoleAssetNotFoundError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type {
  StoryRoleAssetReferenceRepository,
  StoryRoleAssetRepository,
} from '../ports/story-role-asset-repository.js';

export class ArchiveStoryRoleAsset {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly roles: StoryRoleAssetRepository,
    private readonly references: StoryRoleAssetReferenceRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    roleId: string;
    expectedRevision: number;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      const access = await readStoryRoleProjectAccess(
        {
          projects: this.projects,
          memberships: this.memberships,
          collaborators: this.collaborators,
        },
        {
          ...input,
          lock: true,
          permission: 'edit',
        },
      );
      const current = await this.roles.findByIdLocked({
        tenantId: access.project.tenantId,
        projectId: access.project.id,
        roleId: input.roleId,
      });
      if (current === null) throw new StoryRoleAssetNotFoundError();
      if (
        await this.references.hasReferences({
          tenantId: access.project.tenantId,
          projectId: access.project.id,
          roleId: input.roleId,
        })
      ) {
        throw new StoryRoleAssetInUseError();
      }

      const role = StoryRoleAsset.restore(current);
      const now = await this.databaseClock.now();
      role.archive(input.expectedRevision, input.actorUserId, now);
      const archived = role.toSnapshot();
      await this.roles.update(archived);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        spaceId: access.project.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_ROLE_ASSET_ARCHIVED',
        targetType: 'STORY_ROLE_ASSET',
        targetId: archived.id,
        beforeSummary: roleSummary(current),
        afterSummary: roleSummary(archived),
        requestId: input.requestId,
        occurredAt: now,
      });
    });
  }
}

function roleSummary(role: StoryRoleAssetSnapshot) {
  return {
    projectId: role.projectId,
    category: role.category,
    name: role.name,
    revision: role.revision,
    coverAssetId: role.coverAssetId,
    viewAssetId: role.viewAssetId,
    archivedAt: role.archivedAt,
  };
}
