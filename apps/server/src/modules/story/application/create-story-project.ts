import { StoryProject } from '../../../domain/story/story-project.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { projectOutput } from './project-output.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'CREATE_STORY_PROJECT';

export class CreateStoryProject {
  constructor(
    private readonly projects: StoryProjectRepository,
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
    tenantId: string;
    actorUserId: string;
    title: string;
    visibility: 'team' | 'private';
    idempotencyKey: string;
    requestId: string;
  }) {
    const requestHash = this.fingerprint.hash(
      JSON.stringify({
        title: input.title.trim(),
        visibility: input.visibility,
      }),
    );
    const scopeKey = `tenant:${input.tenantId}:user:${input.actorUserId}`;

    return this.transactions.run(async () => {
      const actor = await this.memberships.findActive({
        tenantId: input.tenantId,
        userId: input.actorUserId,
      });
      if (actor === null) throw new StoryProjectAccessDeniedError();

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
          tenantId: input.tenantId,
          projectId: existing.resultId,
        });
        if (project === null)
          throw new Error('Idempotency result project is unavailable');
        return {
          project: projectOutput(project, {
            collaborator: false,
            canEdit: true,
            canManageCollaborators: project.visibility === 'team',
          }),
        };
      }

      const now = await this.databaseClock.now();
      const project = StoryProject.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        createdByUserId: input.actorUserId,
        title: input.title,
        visibility: input.visibility,
        createdAt: now,
      }).toSnapshot();
      await this.projects.create(project);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: project.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_CREATED',
        targetType: 'STORY_PROJECT',
        targetId: project.id,
        beforeSummary: null,
        afterSummary: {
          title: project.title,
          visibility: project.visibility,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        project: projectOutput(project, {
          collaborator: false,
          canEdit: true,
          canManageCollaborators: project.visibility === 'team',
        }),
      };
    });
  }
}
