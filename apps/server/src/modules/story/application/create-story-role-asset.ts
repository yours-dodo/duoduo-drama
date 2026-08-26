import {
  StoryRoleAsset,
  type StoryRoleCategory,
  type StoryRoleAssetMutation,
} from '../../../domain/story/story-role-asset.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { readStoryRoleProjectAccess } from './story-role-asset-access.js';
import {
  storyRoleAssetOutput,
  type StoryRoleAssetOutputDependencies,
} from './story-role-asset-output.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { StoryRoleAssetRepository } from '../ports/story-role-asset-repository.js';

const OPERATION_TYPE = 'CREATE_STORY_ROLE_ASSET';

export class CreateStoryRoleAsset {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly roles: StoryRoleAssetRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly ids: { create(): string },
    private readonly outputDependencies?: StoryRoleAssetOutputDependencies,
  ) {}

  execute(
    input: {
      tenantId: string | null;
      actorUserId: string;
      projectId: string;
      idempotencyKey: string;
      requestId: string;
      category: StoryRoleCategory;
      name: string;
    } & Omit<StoryRoleAssetMutation, 'category' | 'name'>,
  ) {
    const requestHash = this.fingerprint.hash(
      JSON.stringify({
        projectId: input.projectId,
        category: input.category,
        name: input.name,
        occupation: input.occupation,
        personalityCore: input.personalityCore,
        motivationConflict: input.motivationConflict,
        mainlineRelation: input.mainlineRelation,
        gender: input.gender,
        camp: input.camp,
        appearanceFrequency: input.appearanceFrequency,
        speechProfile: input.speechProfile,
        viewAssetId: input.viewAssetId,
      }),
    );

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
      const scopeKey = `space:${access.project.spaceId}:story-project:${access.project.id}`;
      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const role = await this.roles.findById({
          tenantId: access.project.tenantId,
          projectId: access.project.id,
          roleId: existing.resultId,
        });
        if (role === null) {
          throw new Error('Idempotency result story role asset is unavailable');
        }
        return {
          roleAsset: await storyRoleAssetOutput(role, this.outputDependencies),
        };
      }

      const now = await this.databaseClock.now();
      const role = StoryRoleAsset.create({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        projectId: access.project.id,
        category: input.category,
        name: input.name,
        occupation: input.occupation,
        personalityCore: input.personalityCore,
        motivationConflict: input.motivationConflict,
        mainlineRelation: input.mainlineRelation,
        gender: input.gender,
        camp: input.camp,
        appearanceFrequency: input.appearanceFrequency,
        speechProfile: input.speechProfile,
        actorUserId: input.actorUserId,
        createdAt: now,
      }).toSnapshot();
      await this.roles.create(role);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: role.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        spaceId: access.project.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_ROLE_ASSET_CREATED',
        targetType: 'STORY_ROLE_ASSET',
        targetId: role.id,
        beforeSummary: null,
        afterSummary: roleSummary(role),
        requestId: input.requestId,
        occurredAt: now,
      });
      return {
        roleAsset: await storyRoleAssetOutput(role, this.outputDependencies),
      };
    });
  }
}

function roleSummary(role: ReturnType<StoryRoleAsset['toSnapshot']>) {
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
