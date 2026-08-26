import type { AgentGateway } from '../../../integrations/agent/agent-contracts.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { canArchiveProject } from '../../../domain/story/project-access-policy.js';
import { StoryProject } from '../../../domain/story/story-project.js';
import type { ProjectCollaboratorRole } from '../../../domain/story/project-collaborator.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import { projectOutput } from './project-output.js';
import {
  readProjectAccess,
  requireProjectEdit,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';

export class GenerateStoryProjectTags {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly gateway: AgentGateway,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    title?: string;
    description?: string;
    expectedRevision: number;
    requestId: string;
  }) {
    const membership =
      input.tenantId === null
        ? null
        : await this.memberships.findActive({
            tenantId: input.tenantId,
            userId: input.actorUserId,
          });
    if (input.tenantId !== null && membership === null) {
      throw new StoryProjectAccessDeniedError();
    }

    const currentAccess = await readProjectAccess(
      this.projects,
      this.collaborators,
      {
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        membership,
        lock: false,
      },
    );
    requireProjectEdit(currentAccess.project, currentAccess.subject);
    const title = input.title?.trim() || currentAccess.project.title;
    const description =
      input.description?.trim() || currentAccess.project.description || '';
    const generated = await this.gateway.summarizeStoryTags({
      title,
      description,
    });

    return this.transactions.run(async () => {
      const access = await readProjectAccess(
        this.projects,
        this.collaborators,
        {
          tenantId: input.tenantId,
          projectId: input.projectId,
          actorUserId: input.actorUserId,
          membership,
          lock: true,
        },
      );
      requireProjectEdit(access.project, access.subject);
      const project = StoryProject.restore(access.project);
      const now = await this.databaseClock.now();
      const changed = project.update(
        {
          title,
          description,
          era: generated.era,
          tags: generated.tags,
        },
        input.expectedRevision,
        now,
      );
      if (!changed)
        return { project: projectOutput(access.project, accessOutput(access)) };

      const updated = project.toSnapshot();
      await this.projects.update(updated);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        spaceId: updated.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_PROJECT_UPDATED',
        targetType: 'STORY_PROJECT',
        targetId: updated.id,
        beforeSummary: {
          title: access.project.title,
          description: access.project.description ?? '',
          era: access.project.era ?? '现代',
          tags: access.project.tags ?? [],
          revision: access.project.revision,
        },
        afterSummary: {
          title: updated.title,
          description: updated.description ?? '',
          era: updated.era ?? '现代',
          tags: updated.tags ?? [],
          revision: updated.revision,
        },
        requestId: input.requestId,
        occurredAt: now,
      });
      return {
        project: projectOutput(updated, {
          collaborator: access.subject.collaborator,
          collaboratorRole: access.subject.collaboratorRole ?? null,
          canEdit: true,
          canManageCollaborators:
            updated.visibility === 'team' &&
            (access.subject.role === 'admin' ||
              updated.ownerUserId === access.subject.userId),
          canArchive: canArchiveProject(updated, access.subject),
          canRestore: false,
        }),
      };
    });
  }
}

function accessOutput(access: {
  project: {
    visibility: 'team' | 'private';
    ownerUserId: string;
    status: 'active' | 'archived';
    purgeAt?: Date | null;
    purgeStartedAt?: Date | null;
  };
  subject: {
    collaborator: boolean;
    collaboratorRole?: ProjectCollaboratorRole | null;
    role: 'admin' | 'member' | null;
    userId: string;
  };
}) {
  return {
    collaborator: access.subject.collaborator,
    collaboratorRole: access.subject.collaboratorRole ?? null,
    canEdit: true,
    canManageCollaborators:
      access.project.visibility === 'team' &&
      (access.subject.role === 'admin' ||
        access.project.ownerUserId === access.subject.userId),
    canArchive: canArchiveProject(access.project, access.subject),
    canRestore: false,
  };
}
