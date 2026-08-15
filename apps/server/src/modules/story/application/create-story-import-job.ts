import { StoryImportJob } from '../../../domain/story/story-import-job.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  readProjectAccess,
  requireProjectEdit,
} from './project-authorization.js';
import { StoryProjectAccessDeniedError } from './story-errors.js';
import { storyImportJobOutput } from './story-import-job-output.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryImportJobRepository } from '../ports/story-import-job-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'CREATE_STORY_IMPORT_JOB';

export class CreateStoryImportJob {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly importJobs: StoryImportJobRepository,
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
    projectId: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    const normalizedContentType =
      input.contentType.trim() || 'application/octet-stream';
    const requestHash = this.fingerprint.hash(
      JSON.stringify({
        projectId: input.projectId,
        fileName: input.fileName.trim(),
        contentType: normalizedContentType,
        byteSize: input.byteSize,
      }),
    );

    return this.transactions.run(async () => {
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
      const access = await readProjectAccess(
        this.projects,
        this.collaborators,
        {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          projectId: input.projectId,
          membership,
          lock: true,
        },
      );
      requireProjectEdit(access.project, access.subject);

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
        const job = await this.importJobs.findById({
          tenantId: access.project.tenantId,
          jobId: existing.resultId,
        });
        if (job === null) {
          throw new Error('Idempotency result import job is unavailable');
        }
        return { importJob: storyImportJobOutput(job) };
      }

      const now = await this.databaseClock.now();
      const importJob = StoryImportJob.create({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        projectId: access.project.id,
        createdByUserId: input.actorUserId,
        sourceFileName: input.fileName,
        sourceContentType: normalizedContentType,
        sourceByteSize: input.byteSize,
        createdAt: now,
      }).toSnapshot();
      await this.importJobs.create(importJob);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: importJob.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: access.project.tenantId,
        spaceId: access.project.spaceId,
        actorUserId: input.actorUserId,
        action: 'STORY_IMPORT_JOB_CREATED',
        targetType: 'STORY_IMPORT_JOB',
        targetId: importJob.id,
        beforeSummary: null,
        afterSummary: {
          projectId: access.project.id,
          sourceFileName: importJob.sourceFileName,
          sourceContentType: importJob.sourceContentType,
          sourceByteSize: importJob.sourceByteSize,
          status: importJob.status,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return { importJob: storyImportJobOutput(importJob) };
    });
  }
}
