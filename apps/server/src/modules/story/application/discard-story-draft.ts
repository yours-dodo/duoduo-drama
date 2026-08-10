import { StoryArtifact } from '../../../domain/story/story-artifact.js';
import { StoryArtifactVersion } from '../../../domain/story/story-artifact-version.js';
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
import { requireArtifactVersion } from './story-artifact-mutation.js';
import {
  StoryArtifactVersionStateTransitionError,
  StoryProjectAccessDeniedError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

export class DiscardStoryDraft {
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
    versionId: string;
    expectedVersionNumber: number;
    requestId: string;
  }) {
    return this.transactions.run(async () => {
      const access = await this.readEditorAccess(input);
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
      if (source.status !== 'draft') {
        throw new StoryArtifactVersionStateTransitionError();
      }
      const version = StoryArtifactVersion.restore(source);
      version.discard();
      const discarded = version.toSnapshot();
      const allVersions = await this.versions.listForArtifact({
        tenantId: input.tenantId,
        artifactId: access.artifact.id,
      });
      const fallback = allVersions.find(
        (candidate) =>
          candidate.id !== source.id && candidate.status === 'confirmed',
      );
      const now = await this.databaseClock.now();
      const artifact = StoryArtifact.restore(access.artifact);
      artifact.setCurrentVersion(fallback?.id ?? null, now);
      const updatedArtifact = artifact.toSnapshot();

      await this.versions.update(discarded);
      await this.artifacts.update(updatedArtifact);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_ARTIFACT_DRAFT_DISCARDED',
        targetType: 'STORY_ARTIFACT_VERSION',
        targetId: discarded.id,
        beforeSummary: {
          artifactId: discarded.artifactId,
          versionNumber: discarded.versionNumber,
          status: source.status,
        },
        afterSummary: {
          artifactId: discarded.artifactId,
          versionNumber: discarded.versionNumber,
          status: discarded.status,
          currentVersionId: updatedArtifact.currentVersionId,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        artifact: artifactOutput(updatedArtifact),
        version: artifactVersionOutput(discarded),
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
