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

export class EditStoryDraft {
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
    content: string;
    contentFormat: 'markdown' | 'text';
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
      const versions = await this.versions.listForArtifact({
        tenantId: input.tenantId,
        artifactId: access.artifact.id,
      });
      const now = await this.databaseClock.now();
      const version = StoryArtifactVersion.createDraft({
        id: this.ids.create(),
        tenantId: input.tenantId,
        artifactId: access.artifact.id,
        versionNumber: (versions[0]?.versionNumber ?? 0) + 1,
        content: input.content,
        contentFormat: input.contentFormat,
        sourceType: 'user',
        sourceMessageId: null,
        generationRequestId: null,
        createdByUserId: input.actorUserId,
        createdAt: now,
      }).toSnapshot();
      const artifact = StoryArtifact.restore(access.artifact);
      artifact.setCurrentVersion(version.id, now);
      const updatedArtifact = artifact.toSnapshot();

      await this.versions.create(version);
      await this.artifacts.update(updatedArtifact);
      await this.audit.record({
        id: this.ids.create(),
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_ARTIFACT_DRAFT_EDITED',
        targetType: 'STORY_ARTIFACT_VERSION',
        targetId: version.id,
        beforeSummary: {
          artifactId: access.artifact.id,
          sourceVersionId: source.id,
          versionNumber: source.versionNumber,
          status: source.status,
        },
        afterSummary: {
          artifactId: version.artifactId,
          versionNumber: version.versionNumber,
          status: version.status,
          sourceType: version.sourceType,
        },
        requestId: input.requestId,
        occurredAt: now,
      });

      return {
        artifact: artifactOutput(updatedArtifact),
        version: artifactVersionOutput(version),
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
