import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import { StoryArtifactVersion } from '../../../domain/story/story-artifact-version.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { IdempotencyRepository } from '../../tenancy/ports/idempotency-repository.js';
import { IdempotencyConflictError } from '../../tenancy/application/create-team.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  artifactOutput,
  artifactVersionOutput,
} from './story-artifact-output.js';
import {
  readArtifactAccess,
  requireArtifactEdit,
} from './artifact-authorization.js';
import { requireArtifactVersion } from './story-artifact-mutation.js';
import {
  StoryArtifactVersionStateTransitionError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'CONFIRM_STORY_ARTIFACT_VERSION' as const;

export class ConfirmStoryDraft {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly versions: StoryArtifactVersionRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly fingerprint: { hash(value: string): string },
    private readonly ids: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    artifactId: string;
    versionId: string;
    expectedVersionNumber: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    const requestHash = this.fingerprint.hash(
      JSON.stringify([
        input.projectId,
        input.artifactId,
        input.versionId,
        input.expectedVersionNumber,
      ]),
    );
    const scopeKey = `tenant:${input.tenantId}:user:${input.actorUserId}:artifact:${input.artifactId}`;

    return this.transactions.run(async () => {
      const access = await this.readEditorAccess(input);
      const existing = await this.idempotency.findLocked({
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
      });
      if (existing !== null) {
        if (existing.requestHash !== requestHash) {
          throw new IdempotencyConflictError();
        }
        const version = await this.versions.findById({
          tenantId: input.tenantId,
          versionId: existing.resultId,
        });
        if (version === null || version.artifactId !== access.artifact.id) {
          throw new Error('Idempotency result artifact version is unavailable');
        }
        return {
          artifact: artifactOutput(access.artifact),
          version: artifactVersionOutput(version),
        };
      }

      const source = requireArtifactVersion(
        access.artifact,
        await this.versions.findById({
          tenantId: input.tenantId,
          versionId: input.versionId,
        }),
        {
          versionId: input.versionId,
          expectedVersionNumber: input.expectedVersionNumber,
          requireCurrent: true,
        },
      );
      if (source.status !== 'draft' && source.status !== 'confirmed') {
        throw new StoryArtifactVersionStateTransitionError();
      }

      const now = await this.databaseClock.now();
      let confirmed = source;
      if (source.status === 'draft') {
        const version = StoryArtifactVersion.restore(source);
        version.confirm();
        confirmed = version.toSnapshot();
        await this.versions.update(confirmed);
        await this.audit.record({
          id: this.ids.create(),
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          action: 'STORY_ARTIFACT_VERSION_CONFIRMED',
          targetType: 'STORY_ARTIFACT_VERSION',
          targetId: confirmed.id,
          beforeSummary: {
            artifactId: confirmed.artifactId,
            versionNumber: confirmed.versionNumber,
            status: source.status,
          },
          afterSummary: {
            artifactId: confirmed.artifactId,
            versionNumber: confirmed.versionNumber,
            status: confirmed.status,
          },
          requestId: input.requestId,
          occurredAt: now,
        });
      }

      const artifact = StoryArtifact.restore(access.artifact);
      artifact.setCurrentVersion(confirmed.id, now);
      const updatedArtifact = artifact.toSnapshot();
      await this.artifacts.update(updatedArtifact);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: input.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: confirmed.id,
        createdAt: now,
      });
      return {
        artifact: artifactOutput(updatedArtifact),
        version: artifactVersionOutput(confirmed),
      };
    });
  }

  private async readEditorAccess(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    artifactId: string;
  }) {
    const membership = await this.memberships.findActive({
      tenantId: input.tenantId,
      userId: input.actorUserId,
    });
    if (membership === null) throw new StoryProjectAccessDeniedError();
    const access = await readArtifactAccess(
      this.projects,
      this.collaborators,
      this.artifacts,
      { ...input, membership, lock: true },
    );
    requireArtifactEdit(access);
    return access;
  }
}
