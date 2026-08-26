import {
  StoryRoleAsset,
  type StoryRoleAssetMutation,
  type StoryRoleAssetSnapshot,
} from '../../../domain/story/story-role-asset.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { SUPPORTED_ASSET_CONTENT_TYPES } from '../../assets/application/asset-upload-policy.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { readStoryRoleProjectAccess } from './story-role-asset-access.js';
import {
  StoryRoleAssetCoverAssetInvalidError,
  StoryRoleAssetNotFoundError,
  StoryRoleAssetViewAssetInvalidError,
} from './story-errors.js';
import {
  storyRoleAssetOutput,
  type StoryRoleAssetOutputDependencies,
} from './story-role-asset-output.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { StoryRoleAssetRepository } from '../ports/story-role-asset-repository.js';

export class UpdateStoryRoleAsset {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly roles: StoryRoleAssetRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
    private readonly outputDependencies?: StoryRoleAssetOutputDependencies,
  ) {}

  execute(
    input: {
      tenantId: string | null;
      actorUserId: string;
      projectId: string;
      roleId: string;
      expectedRevision: number;
      requestId: string;
    } & StoryRoleAssetMutation,
  ) {
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

      if (input.coverAssetId !== undefined && input.coverAssetId !== null) {
        const coverAsset = await this.outputDependencies?.assets.findById({
          tenantId: access.project.tenantId,
          projectId: access.project.id,
          assetId: input.coverAssetId,
        });
        if (
          coverAsset === undefined ||
          coverAsset === null ||
          coverAsset.status !== 'uploaded' ||
          !SUPPORTED_ASSET_CONTENT_TYPES.includes(
            coverAsset.contentType as (typeof SUPPORTED_ASSET_CONTENT_TYPES)[number],
          )
        ) {
          throw new StoryRoleAssetCoverAssetInvalidError();
        }
      }
      if (input.viewAssetId !== undefined && input.viewAssetId !== null) {
        const viewAsset = await this.outputDependencies?.assets.findById({
          tenantId: access.project.tenantId,
          projectId: access.project.id,
          assetId: input.viewAssetId,
        });
        if (
          viewAsset === undefined ||
          viewAsset === null ||
          viewAsset.status !== 'uploaded' ||
          !SUPPORTED_ASSET_CONTENT_TYPES.includes(
            viewAsset.contentType as (typeof SUPPORTED_ASSET_CONTENT_TYPES)[number],
          )
        ) {
          throw new StoryRoleAssetViewAssetInvalidError();
        }
      }

      const role = StoryRoleAsset.restore(current);
      const now = await this.databaseClock.now();
      const changed = role.update(
        mutation(input),
        input.expectedRevision,
        input.actorUserId,
        now,
      );
      if (!changed) {
        return {
          roleAsset: await storyRoleAssetOutput(
            current,
            this.outputDependencies,
          ),
        };
      }

      const updated = role.toSnapshot();
      await this.roles.update(updated);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        spaceId: access.project.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_ROLE_ASSET_UPDATED',
        targetType: 'STORY_ROLE_ASSET',
        targetId: updated.id,
        beforeSummary: roleSummary(current),
        afterSummary: roleSummary(updated),
        requestId: input.requestId,
        occurredAt: now,
      });
      return {
        roleAsset: await storyRoleAssetOutput(updated, this.outputDependencies),
      };
    });
  }
}

function mutation(input: StoryRoleAssetMutation): StoryRoleAssetMutation {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => MUTABLE_KEYS.has(key) && value !== undefined,
    ),
  ) as StoryRoleAssetMutation;
}

const MUTABLE_KEYS = new Set([
  'category',
  'name',
  'occupation',
  'personalityCore',
  'motivationConflict',
  'mainlineRelation',
  'gender',
  'camp',
  'appearanceFrequency',
  'speechProfile',
  'coverAssetId',
  'viewAssetId',
]);

function roleSummary(role: StoryRoleAssetSnapshot) {
  return {
    projectId: role.projectId,
    category: role.category,
    name: role.name,
    occupation: role.occupation,
    revision: role.revision,
    coverAssetId: role.coverAssetId,
    viewAssetId: role.viewAssetId,
  };
}
