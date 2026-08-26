import {
  StoryArtifact,
  STORY_MODULE_DEFINITIONS,
  storyModuleOrder,
} from '../../../domain/story/story-artifact.js';
import { StoryProject } from '../../../domain/story/story-project.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { SpaceRepository } from '../../spaces/ports/space-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { projectOutput } from './project-output.js';
import { artifactOutput } from './story-artifact-output.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'CREATE_STORY_PROJECT';

export class CreateStoryProject {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly spaces: SpaceRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly ids: { create(): string },
  ) {}

  execute(input: {
    tenantId: string | null;
    actorUserId: string;
    title: string;
    creationMode: 'standard' | 'immersive';
    visibility: 'team' | 'private';
    spaceKind?: 'personal' | 'team';
    spaceId?: string;
    idempotencyKey: string;
    requestId: string;
  }) {
    const personal = input.spaceKind === 'personal' || input.tenantId === null;
    const effectiveVisibility = personal ? 'private' : input.visibility;
    const requestHash = this.fingerprint.hash(
      JSON.stringify({
        title: input.title.trim(),
        creationMode: input.creationMode,
        visibility: effectiveVisibility,
        spaceKind: personal ? 'personal' : 'team',
      }),
    );

    return this.transactions.run(async () => {
      if (input.tenantId !== null) {
        const actor = await this.memberships.findActive({
          tenantId: input.tenantId,
          userId: input.actorUserId,
        });
        if (actor === null) throw new StoryProjectAccessDeniedError();
      }

      const space = personal
        ? await this.spaces.findPersonalByUserId(input.actorUserId)
        : input.tenantId === null
          ? null
          : await this.spaces.findTeamByTeamId(input.tenantId);
      if (space === null || space.id !== (input.spaceId ?? space.id)) {
        throw new StoryProjectAccessDeniedError();
      }
      const scopeKey = personal
        ? `space:${space.id}:user:${input.actorUserId}`
        : `tenant:${input.tenantId}:user:${input.actorUserId}`;

      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const project = await this.projects.findById({
          tenantId: personal ? null : input.tenantId,
          projectId: existing.resultId,
        });
        if (project === null)
          throw new Error('Idempotency result project is unavailable');
        const modules = await this.artifacts.listForProject({
          tenantId: project.tenantId,
          projectId: project.id,
        });
        return {
          project: projectOutput(project, {
            collaborator: false,
            canEdit: true,
            canManageCollaborators:
              project.spaceKind === 'team' && project.visibility === 'team',
            canArchive: true,
            canRestore: false,
          }),
          modules: modules
            .sort(
              (left, right) =>
                storyModuleOrder(left.type) - storyModuleOrder(right.type),
            )
            .map(artifactOutput),
        };
      }

      const now = await this.databaseClock.now();
      const project = StoryProject.create({
        id: this.ids.create(),
        tenantId: personal ? null : input.tenantId,
        spaceId: space.id,
        spaceKind: personal ? 'personal' : 'team',
        createdByUserId: input.actorUserId,
        ownerUserId: input.actorUserId,
        title: input.title,
        creationMode: input.creationMode,
        visibility: effectiveVisibility,
        createdAt: now,
      }).toSnapshot();
      await this.projects.create(project);
      const modules = STORY_MODULE_DEFINITIONS.map(({ type, title }) =>
        StoryArtifact.create({
          id: this.ids.create(),
          tenantId: project.tenantId,
          projectId: project.id,
          type,
          title,
          createdAt: now,
        }).toSnapshot(),
      );
      for (const module of modules) {
        await this.artifacts.create(module);
      }
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: project.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: project.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: project.tenantId,
        spaceId: project.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_CREATED',
        targetType: 'STORY_PROJECT',
        targetId: project.id,
        beforeSummary: null,
        afterSummary: {
          title: project.title,
          creationMode: project.creationMode,
          visibility: project.visibility,
          spaceKind: project.spaceKind,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        project: projectOutput(project, {
          collaborator: false,
          canEdit: true,
          canManageCollaborators:
            project.spaceKind === 'team' && project.visibility === 'team',
          canArchive: true,
          canRestore: false,
        }),
        modules: modules.map(artifactOutput),
      };
    });
  }
}
