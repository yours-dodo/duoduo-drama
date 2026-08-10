import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import type { AuditRepository } from '../../audit/ports/audit-repository.js';
import type { TeamMembershipRepository } from '../../tenancy/ports/team-membership-repository.js';
import {
  artifactOutput,
  artifactVersionOutput,
} from './story-artifact-output.js';
import {
  readArtifactAccess,
  requireArtifactEdit,
} from './artifact-authorization.js';
import { currentVersionNumber } from './story-artifact-mutation.js';
import {
  StoryArtifactVersionConflictError,
  StoryArtifactVersionNotFoundError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class RollbackStoryArtifact {
  constructor(
    private readonly projects: StoryProjectRepository,
    private readonly memberships: TeamMembershipRepository,
    private readonly collaborators: ProjectCollaboratorRepository,
    private readonly artifacts: StoryArtifactRepository,
    private readonly versions: StoryArtifactVersionRepository,
    private readonly audit: AuditRepository,
    private readonly transactions: {
      run<T>(operation: () => Promise<T>): Promise<T>;
    },
    private readonly databaseClock: { now(): Promise<Date> },
    private readonly ids: { create(): string },
  ) {}

  async execute(input: {
    tenantId: string;
    actorUserId: string;
    projectId: string;
    artifactId: string;
    targetVersionNumber: number;
    expectedCurrentVersionNumber: number | null;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      const access = await this.readEditorAccess(input);
      const versions = await this.versions.listForArtifact({
        tenantId: input.tenantId,
        artifactId: access.artifact.id,
      });
      const actualCurrentVersionNumber = currentVersionNumber(
        access.artifact,
        versions,
      );
      if (actualCurrentVersionNumber !== input.expectedCurrentVersionNumber) {
        throw new StoryArtifactVersionConflictError();
      }
      const target = versions.find(
        (version) => version.versionNumber === input.targetVersionNumber,
      );
      if (target === undefined || target.status !== 'confirmed') {
        throw new StoryArtifactVersionNotFoundError();
      }
      const now = await this.databaseClock.now();
      const artifact = StoryArtifact.restore(access.artifact);
      artifact.setCurrentVersion(target.id, now);
      const updatedArtifact = artifact.toSnapshot();
      await this.artifacts.update(updatedArtifact);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_ARTIFACT_VERSION_ROLLED_BACK',
        targetType: 'STORY_ARTIFACT',
        targetId: updatedArtifact.id,
        beforeSummary: {
          currentVersionId: access.artifact.currentVersionId,
          currentVersionNumber: actualCurrentVersionNumber,
        },
        afterSummary: {
          currentVersionId: target.id,
          currentVersionNumber: target.versionNumber,
        },
        requestId: input.requestId,
        occurredAt: now,
      });
      return {
        artifact: artifactOutput(updatedArtifact),
        version: artifactVersionOutput(target),
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
