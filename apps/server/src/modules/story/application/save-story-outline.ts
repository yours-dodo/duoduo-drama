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
import { readStoryOutlineAccess } from './story-outline-access.js';
import {
  StoryArtifactVersionConflictError,
  StoryOutlineContentInvalidError,
} from './story-errors.js';
import type { ProjectCollaboratorRepository } from '../ports/project-collaborator-repository.js';
import type { StoryArtifactRepository } from '../ports/story-artifact-repository.js';
import type { StoryArtifactVersionRepository } from '../ports/story-artifact-version-repository.js';
import type { StoryProjectRepository } from '../ports/story-project-repository.js';

const OPERATION_TYPE = 'SAVE_STORY_OUTLINE' as const;

export class SaveStoryOutline {
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
    tenantId: string | null;
    actorUserId: string;
    projectId: string;
    content: string;
    expectedVersionNumber?: number;
    idempotencyKey: string;
    requestId: string;
  }) {
    validateNarrativeContent(input.content);
    return this.transactions.run(async () => {
      const access = await readStoryOutlineAccess(
        {
          projects: this.projects,
          memberships: this.memberships,
          collaborators: this.collaborators,
          artifacts: this.artifacts,
        },
        { ...input, lock: true, permission: 'edit' },
      );
      const scopeKey = `${input.tenantId === null ? `user:${input.actorUserId}` : `tenant:${input.tenantId}:user:${input.actorUserId}`}:artifact:${access.artifact.id}`;
      const requestHash = this.fingerprint.hash(
        JSON.stringify({
          projectId: input.projectId,
          content: input.content,
          expectedVersionNumber: input.expectedVersionNumber,
        }),
      );
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
          tenantId: access.artifact.tenantId,
          versionId: existing.resultId,
        });
        if (version === null || version.artifactId !== access.artifact.id) {
          throw new Error('Idempotency result outline version is unavailable');
        }
        return {
          artifact: artifactOutput(access.artifact),
          version: artifactVersionOutput(version),
        };
      }
      const versions = await this.versions.listForArtifact({
          tenantId: access.artifact.tenantId,
          artifactId: access.artifact.id,
        });
      const latestVersionNumber = versions.reduce(
        (latest, version) => Math.max(latest, version.versionNumber),
        0,
      );
      const current = access.artifact.currentVersionId
        ? (versions.find(
            (version) => version.id === access.artifact.currentVersionId,
          ) ?? null)
        : null;
      if (
        input.expectedVersionNumber !== undefined &&
        current?.versionNumber !== input.expectedVersionNumber
      ) {
        throw new StoryArtifactVersionConflictError();
      }

      const now = await this.databaseClock.now();
      let version: ReturnType<StoryArtifactVersion['toSnapshot']>;
      let created = false;
      if (current?.status === 'draft') {
        const draft = StoryArtifactVersion.restore(current);
        draft.updateDraftContent(input.content, 'json');
        version = draft.toSnapshot();
        await this.versions.update(version);
      } else {
        const draft = StoryArtifactVersion.createDraft({
          id: this.ids.create(),
          tenantId: access.artifact.tenantId,
          artifactId: access.artifact.id,
          versionNumber: latestVersionNumber + 1,
          content: input.content,
          contentFormat: 'json',
          sourceType: 'user',
          sourceMessageId: null,
          generationRequestId: null,
          createdByUserId: input.actorUserId,
          createdAt: now,
        });
        version = draft.toSnapshot();
        created = true;
        await this.versions.create(version);
      }

      const artifact = StoryArtifact.restore(access.artifact);
      artifact.setCurrentVersion(version.id, now);
      const updatedArtifact = artifact.toSnapshot();
      await this.artifacts.update(updatedArtifact);
      await this.idempotency.create({
        id: this.ids.create(),
        tenantId: access.artifact.tenantId,
        scopeKey,
        operationType: OPERATION_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        resultId: version.id,
        createdAt: now,
      });
      await this.audit.record({
        id: this.ids.create(),
        tenantId: access.artifact.tenantId,
        actorUserId: input.actorUserId,
        action: 'STORY_ARTIFACT_DRAFT_EDITED',
        targetType: 'STORY_ARTIFACT_VERSION',
        targetId: version.id,
        beforeSummary: current
          ? {
              artifactId: current.artifactId,
              versionNumber: current.versionNumber,
              status: current.status,
            }
          : null,
        afterSummary: {
          artifactId: version.artifactId,
          versionNumber: version.versionNumber,
          status: version.status,
          sourceType: version.sourceType,
          created,
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
}

function validateNarrativeContent(content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new StoryOutlineContentInvalidError();
  }
  if (!isNarrativeDocumentPayload(parsed)) {
    throw new StoryOutlineContentInvalidError();
  }
}

function isNarrativeDocumentPayload(value: unknown): value is {
  schemaVersion: 'narrative-planning.v1';
  rootStoryId: string;
  story: Record<string, unknown>;
  arcs: unknown[];
  chapters: unknown[];
  beats: unknown[];
  assets: unknown[];
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 'narrative-planning.v1' &&
    typeof candidate.rootStoryId === 'string' &&
    isRecord(candidate.story) &&
    typeof candidate.story.id === 'string' &&
    candidate.story.type === 'story' &&
    typeof candidate.story.title === 'string' &&
    typeof candidate.story.summary === 'string' &&
    isStringArray(candidate.story.arcIds) &&
    isEntityArray(candidate.arcs, 'arc') &&
    isEntityArray(candidate.chapters, 'chapter') &&
    isEntityArray(candidate.beats, 'beat') &&
    isEntityArray(candidate.assets)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isEntityArray(
  value: unknown,
  type?: string,
): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        (type === undefined || item.type === type),
    )
  );
}
